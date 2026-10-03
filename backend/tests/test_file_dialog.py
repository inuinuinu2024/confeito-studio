"""/api/local-files: the folder check and the image picked in the file dialog.

The real dialog is never opened: ``_ask_open_filename`` is replaced in every test.
"""

from pathlib import Path
from urllib.parse import unquote

import pytest

from src.app.config import settings
from src.app.services import file_dialog_service

from .conftest import make_png


@pytest.fixture
def dialog(monkeypatch: pytest.MonkeyPatch) -> dict:
    """Records the dialog's start folder and answers with ``state["answer"]`` ("" = cancelled)."""
    state: dict = {"answer": "", "calls": []}

    def fake(initial_dir: Path) -> str:
        state["calls"].append(initial_dir)
        return state["answer"]

    monkeypatch.setattr(file_dialog_service, "_ask_open_filename", fake)
    return state


def test_check_folder(client, tmp_path: Path) -> None:
    assert client.post("/api/local-files/check-folder", json={"path": str(tmp_path)}).status_code == 200
    # Quotes from Windows' "Copy as path" are removed; empty means the dialog's default.
    assert client.post("/api/local-files/check-folder", json={"path": f'"{tmp_path}"'}).status_code == 200
    assert client.post("/api/local-files/check-folder", json={"path": "  "}).status_code == 200

    missing = client.post("/api/local-files/check-folder", json={"path": str(tmp_path / "nope")})
    assert missing.status_code == 404
    assert missing.json()["detail"].startswith("フォルダが見つかりません")
    relative = client.post("/api/local-files/check-folder", json={"path": "images"})
    assert relative.status_code == 404
    assert "絶対パス" in relative.json()["detail"]


def test_pick_image_returns_the_file(client, tmp_path: Path, dialog: dict) -> None:
    image = tmp_path / "ページ 1.png"
    image.write_bytes(make_png(4, 3))
    dialog["answer"] = str(image)

    res = client.post("/api/local-files/pick-image", json={"initial_dir": str(tmp_path)})
    assert res.status_code == 200
    assert res.content == image.read_bytes()
    assert res.headers["content-type"] == "image/png"
    assert unquote(res.headers["x-file-name"]) == "ページ 1.png"
    assert dialog["calls"] == [tmp_path]


def test_pick_image_cancelled(client, dialog: dict) -> None:
    res = client.post("/api/local-files/pick-image", json={"initial_dir": ""})
    assert res.status_code == 204
    # No folder set: the dialog opens in the project folder.
    assert dialog["calls"] == [settings.project_dir]


def test_pick_image_rejects_a_missing_folder_without_opening(client, tmp_path: Path, dialog: dict) -> None:
    res = client.post("/api/local-files/pick-image", json={"initial_dir": str(tmp_path / "nope")})
    assert res.status_code == 404
    assert dialog["calls"] == []


def test_pick_image_rejects_other_files(client, tmp_path: Path, dialog: dict) -> None:
    text = tmp_path / "memo.txt"
    text.write_text("x", encoding="utf-8")
    dialog["answer"] = str(text)
    res = client.post("/api/local-files/pick-image", json={})
    assert res.status_code == 400
    assert res.json()["detail"] == "画像ファイルではありません: memo.txt"


def test_only_one_dialog_at_a_time(client, dialog: dict) -> None:
    assert file_dialog_service._dialog_lock.acquire(blocking=False)
    try:
        res = client.post("/api/local-files/pick-image", json={})
    finally:
        file_dialog_service._dialog_lock.release()
    assert res.status_code == 400
    assert "すでに開いています" in res.json()["detail"]
    assert dialog["calls"] == []
