"""Anime face detection for character icons. The model is never downloaded or run here."""

import io
from pathlib import Path

import numpy as np
import pytest
import requests
from PIL import Image

from src.app.config import settings
from src.app.errors import BadRequestError
from src.app.services import face_service as svc

from .conftest import make_png


@pytest.fixture(autouse=True)
def models_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.setattr(settings, "models_dir", tmp_path / "models")
    monkeypatch.setattr(svc, "_session", None)
    return tmp_path / "models"


def prediction(*boxes: tuple[float, float, float, float, float]) -> np.ndarray:
    """A YOLOv8 output (1, 5, N) from (cx, cy, w, h, score) rows."""
    return np.array(boxes, dtype=np.float32).T[np.newaxis]


def test_preprocess_scales_the_long_side_to_640_and_pads_to_32() -> None:
    tensor, scale = svc.preprocess(Image.new("RGB", (1000, 500), (255, 0, 0)))
    assert scale == 0.64
    assert tensor.shape == (1, 3, 320, 640)
    assert tensor[0, 0, 0, 0] == 1.0 and tensor[0, 1, 0, 0] == 0.0
    tensor, _ = svc.preprocess(Image.new("RGB", (300, 410)))
    assert tensor.shape == (1, 3, 640, 480)  # 300 * 640/410 = 468 → padded to 480


def test_postprocess_scales_back_filters_and_removes_overlaps() -> None:
    output = prediction(
        (100, 100, 40, 60, 0.9),
        (102, 101, 40, 60, 0.8),  # overlaps the first: removed
        (300, 200, 20, 20, 0.5),
        (500, 500, 50, 50, 0.1),  # under the threshold
        (630, 10, 40, 40, 0.6),  # sticks out of the image: clipped
    )
    faces = svc.postprocess(output, 0.5, 1280, 1280)
    assert [round(f["score"], 1) for f in faces] == [0.9, 0.6, 0.5]
    assert faces[0] == pytest.approx({"x": 160, "y": 140, "width": 80, "height": 120, "score": 0.9}, rel=1e-5)
    assert faces[1]["x"] + faces[1]["width"] <= 1280 and faces[1]["y"] == 0
    assert svc.postprocess(prediction((1, 1, 1, 1, 0.1)), 1.0, 10, 10) == []


class FakeSession:
    def get_inputs(self):
        return [type("Input", (), {"name": "images"})()]

    def run(self, _outputs, feeds):
        assert feeds["images"].shape == (1, 3, 640, 640)
        return [prediction((320, 320, 64, 64, 0.95))]


def test_detect_faces_composites_transparency_and_returns_image_pixels(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(svc, "_session", FakeSession())
    faces = svc.detect_faces(make_png(100, 100, (0, 0, 0, 0)))
    assert faces == [pytest.approx({"x": 45, "y": 45, "width": 10, "height": 10, "score": 0.95}, rel=1e-5)]
    with pytest.raises(BadRequestError, match="画像として読めない"):
        svc.detect_faces(b"not an image")


def test_open_rgb_puts_transparent_pixels_on_white() -> None:
    assert svc._open_rgb(make_png(2, 2, (0, 0, 0, 0))).getpixel((0, 0)) == (255, 255, 255)
    buf = io.BytesIO()
    Image.new("RGB", (2, 2), (10, 20, 30)).save(buf, format="JPEG", quality=100)
    assert svc._open_rgb(buf.getvalue()).mode == "RGB"


class FakeResponse:
    def __init__(self, chunks: list[bytes], fail: bool = False) -> None:
        self.chunks, self.fail = chunks, fail

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def raise_for_status(self) -> None:
        if self.fail:
            raise requests.HTTPError("404 Not Found")

    def iter_content(self, chunk_size: int):
        yield from self.chunks


def test_model_is_downloaded_once_into_models(monkeypatch: pytest.MonkeyPatch, models_dir: Path) -> None:
    calls: list[str] = []

    def fake_get(url: str, **_kwargs):
        calls.append(url)
        return FakeResponse([b"onnx", b"-bytes"])

    monkeypatch.setattr(svc.requests, "get", fake_get)
    svc._download_model()
    assert calls == [svc.MODEL_URL]
    assert (models_dir / "anime_face_detect_v1.4_s.onnx").read_bytes() == b"onnx-bytes"
    assert not list(models_dir.glob("*.download"))


def test_failed_download_leaves_nothing(monkeypatch: pytest.MonkeyPatch, models_dir: Path) -> None:
    monkeypatch.setattr(svc.requests, "get", lambda *_a, **_k: FakeResponse([], fail=True))
    with pytest.raises(svc.FaceModelError, match="ダウンロードできませんでした") as info:
        svc._get_session()
    assert info.value.status_code == 502 and "404" in info.value.raw_response
    assert not models_dir.exists() or not any(models_dir.iterdir())


def test_unreadable_model_is_reported(models_dir: Path) -> None:
    models_dir.mkdir(parents=True)
    (models_dir / "anime_face_detect_v1.4_s.onnx").write_bytes(b"broken")
    with pytest.raises(svc.FaceModelError, match="読み込めませんでした"):
        svc._get_session()


def test_detect_faces_route(client, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(svc, "_session", FakeSession())
    res = client.post("/api/characters/detect-faces", files={"image": ("a.png", make_png(64, 64), "image/png")})
    assert res.status_code == 200
    assert len(res.json()["faces"]) == 1 and res.json()["warnings"] == []
    bad = client.post("/api/characters/detect-faces", files={"image": ("a.txt", b"x", "text/plain")})
    assert bad.status_code == 400
