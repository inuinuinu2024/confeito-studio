"""Anime face detection for character icons (docs/specs/character-manager.md 「顔の検出」).

The model is deepghs/anime_face_detection ``face_detect_v1.4_s`` (YOLOv8s, ONNX, MIT), run on the CPU with
onnxruntime (installed with rembg). It is downloaded into ``models/`` the first time a face is detected.
The input is scaled so that its longer side is 640 px and padded to a multiple of 32; the output is
YOLOv8's ``(1, 5, N)``: centre x, centre y, width, height and score in input pixels.
"""

import io
import threading
from typing import Any

import numpy as np
import requests
from PIL import Image, UnidentifiedImageError

from ..config import settings
from ..errors import AppError, BadRequestError, exception_text

# Pinned revision so that the file never changes under the app.
MODEL_URL = (
    "https://huggingface.co/deepghs/anime_face_detection/resolve/"
    "784dc4c0bb692351ddcdbe6131a050b17d3025d5/face_detect_v1.4_s/model.onnx"
)
INPUT_SIZE = 640
STRIDE = 32
SCORE_THRESHOLD = 0.307  # threshold.json of the model
IOU_THRESHOLD = 0.7
DOWNLOAD_TIMEOUT = 60  # seconds without data

_lock = threading.Lock()
_session: Any = None


class FaceModelError(AppError):
    status_code = 502


def _download_model() -> None:
    """Downloads the model into a temp file next to it, then moves it in place."""
    path = settings.face_model_file
    tmp = path.with_name(f"{path.name}.download")
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        with requests.get(MODEL_URL, stream=True, timeout=DOWNLOAD_TIMEOUT) as res:
            res.raise_for_status()
            with tmp.open("wb") as f:
                for chunk in res.iter_content(chunk_size=1 << 20):
                    f.write(chunk)
        tmp.replace(path)
    except (requests.RequestException, OSError) as e:
        tmp.unlink(missing_ok=True)
        raise FaceModelError(
            "顔検出のモデルをダウンロードできませんでした。インターネット接続を確認してください。",
            raw_response=exception_text(e),
        ) from e


def _get_session() -> Any:
    """The onnxruntime session, created (and the model downloaded) on first use."""
    global _session
    with _lock:
        if _session is None:
            if not settings.face_model_file.exists():
                _download_model()
            import onnxruntime as ort

            try:
                _session = ort.InferenceSession(str(settings.face_model_file), providers=["CPUExecutionProvider"])
            except Exception as e:
                raise FaceModelError(
                    "顔検出のモデルを読み込めませんでした。models/ のファイルを確認してください。",
                    raw_response=exception_text(e),
                ) from e
        return _session


def preprocess(img: Image.Image) -> tuple[np.ndarray, float]:
    """The input tensor (1, 3, H, W) in 0..1 and the scale from the image to it."""
    scale = INPUT_SIZE / max(img.width, img.height)
    width, height = max(1, round(img.width * scale)), max(1, round(img.height * scale))
    resized = img.resize((width, height), Image.Resampling.BILINEAR)
    padded = np.zeros((-(-height // STRIDE) * STRIDE, -(-width // STRIDE) * STRIDE, 3), dtype=np.float32)
    padded[:height, :width] = np.asarray(resized, dtype=np.float32) / 255.0
    return padded.transpose(2, 0, 1)[np.newaxis], scale


def _iou(box: np.ndarray, boxes: np.ndarray) -> np.ndarray:
    x1 = np.maximum(box[0], boxes[:, 0])
    y1 = np.maximum(box[1], boxes[:, 1])
    x2 = np.minimum(box[2], boxes[:, 2])
    y2 = np.minimum(box[3], boxes[:, 3])
    inter = np.clip(x2 - x1, 0, None) * np.clip(y2 - y1, 0, None)
    area = (box[2] - box[0]) * (box[3] - box[1])
    areas = (boxes[:, 2] - boxes[:, 0]) * (boxes[:, 3] - boxes[:, 1])
    return inter / np.maximum(area + areas - inter, 1e-9)


def postprocess(output: np.ndarray, scale: float, width: int, height: int) -> list[dict[str, float]]:
    """Faces in image pixels (clipped to the image), highest score first, overlaps removed."""
    preds = output[0].T  # (N, 5)
    preds = preds[preds[:, 4] >= SCORE_THRESHOLD]
    if len(preds) == 0:
        return []
    cx, cy, w, h = preds[:, 0], preds[:, 1], preds[:, 2], preds[:, 3]
    boxes = np.stack([cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2], axis=1) / scale
    boxes = np.clip(boxes, 0, [width, height, width, height])
    order = np.argsort(-preds[:, 4])
    boxes, scores = boxes[order], preds[order, 4]
    kept: list[int] = []
    for i in range(len(boxes)):
        if all(_iou(boxes[i], boxes[[k]])[0] < IOU_THRESHOLD for k in kept):
            kept.append(i)
    return [
        {
            "x": float(boxes[i, 0]),
            "y": float(boxes[i, 1]),
            "width": float(boxes[i, 2] - boxes[i, 0]),
            "height": float(boxes[i, 3] - boxes[i, 1]),
            "score": float(scores[i]),
        }
        for i in kept
        if boxes[i, 2] > boxes[i, 0] and boxes[i, 3] > boxes[i, 1]
    ]


def _open_rgb(data: bytes) -> Image.Image:
    """The image as RGB; transparent parts become white (anime images are often cut out)."""
    try:
        img = Image.open(io.BytesIO(data))
        img.load()
    except (UnidentifiedImageError, OSError, ValueError) as e:
        raise BadRequestError("画像として読めないファイルです。", raw_response=exception_text(e)) from e
    if img.mode in ("RGBA", "LA", "P"):
        rgba = img.convert("RGBA")
        background = Image.new("RGBA", rgba.size, (255, 255, 255, 255))
        return Image.alpha_composite(background, rgba).convert("RGB")
    return img.convert("RGB")


def detect_faces(data: bytes) -> list[dict[str, float]]:
    """The anime faces in an image (PNG / JPEG / WebP …), in its pixel coordinates."""
    img = _open_rgb(data)
    session = _get_session()
    tensor, scale = preprocess(img)
    output = session.run(None, {session.get_inputs()[0].name: tensor})[0]
    return postprocess(output, scale, img.width, img.height)
