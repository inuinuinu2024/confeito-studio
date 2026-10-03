"""Background removal with rembg (isnet-anime model in U2NET_HOME, by default <repo>/models; see config.py)."""

import functools
import io
from typing import Any

from PIL import Image

REMBG_MODEL = "isnet-anime"


@functools.cache
def _session() -> Any:
    # rembg pulls in onnxruntime/numba/pymatting (seconds to import): load on first use only.
    from rembg import new_session

    return new_session(REMBG_MODEL)


def remove_background(
    image_bytes: bytes,
    alpha_matting: bool = False,
    alpha_matting_foreground_threshold: int = 240,
    alpha_matting_background_threshold: int = 10,
    alpha_matting_erode_size: int = 10,
) -> bytes:
    """Returns PNG bytes of ``image_bytes`` with the background made transparent."""
    from rembg import remove

    output = remove(
        Image.open(io.BytesIO(image_bytes)),
        session=_session(),
        alpha_matting=alpha_matting,
        alpha_matting_foreground_threshold=alpha_matting_foreground_threshold,
        alpha_matting_background_threshold=alpha_matting_background_threshold,
        alpha_matting_erode_size=alpha_matting_erode_size,
    )
    buf = io.BytesIO()
    output.save(buf, format="PNG")
    return buf.getvalue()
