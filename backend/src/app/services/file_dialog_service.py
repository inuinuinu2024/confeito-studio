"""File and folder selection dialogs of the PC running the backend (画像読み込み, docs/specs/tools/image-loader.md;
the ARCHIVES folder in the settings window, docs/specs/archives.md 「保存先」).

The browser's file picker cannot start in an arbitrary folder nor return a folder's full path, so the backend
opens the OS dialog (tkinter): in the folder set in the tool, or in the project folder when none is set.
Only one dialog is open at a time.
"""

import threading
from pathlib import Path

from ..config import settings
from ..errors import BadRequestError, NotFoundError, unexpected_errors_as

IMAGE_SUFFIXES = (".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif")

_dialog_lock = threading.Lock()


def normalize_folder(path: str | None) -> Path | None:
    """The folder setting as a path (surrounding spaces / quotes removed); None when empty.

    Raises ``NotFoundError`` unless it is an existing folder given as an absolute path.
    """
    text = (path or "").strip().strip('"').strip()
    if not text:
        return None
    folder = Path(text)
    if not folder.is_absolute():
        raise NotFoundError(f"フォルダは絶対パスで指定してください: {text}")
    if not folder.is_dir():
        raise NotFoundError(f"フォルダが見つかりません: {text}")
    return folder


def _ask_open_filename(initial_dir: Path) -> str:
    """Shows the dialog above other windows; "" when cancelled."""
    import tkinter as tk
    from tkinter import filedialog

    root = tk.Tk()
    root.withdraw()
    root.attributes("-topmost", True)
    try:
        return filedialog.askopenfilename(
            parent=root,
            title="画像を選択",
            initialdir=str(initial_dir),
            filetypes=[("画像ファイル", " ".join(f"*{s}" for s in IMAGE_SUFFIXES))],
        )
    finally:
        root.destroy()


def _ask_directory(initial_dir: Path) -> str:
    """Shows the folder dialog above other windows; "" when cancelled."""
    import tkinter as tk
    from tkinter import filedialog

    root = tk.Tk()
    root.withdraw()
    root.attributes("-topmost", True)
    try:
        return filedialog.askdirectory(parent=root, title="ARCHIVES の保存先を選択", initialdir=str(initial_dir))
    finally:
        root.destroy()


def pick_folder(initial_dir: str | None) -> str | None:
    """Lets the user choose a folder; its full path, or None when cancelled.

    The dialog opens in ``initial_dir`` when it is an existing folder, else in the project folder.
    """
    text = (initial_dir or "").strip().strip('"').strip()
    folder = Path(text) if text and Path(text).is_absolute() and Path(text).is_dir() else settings.project_dir
    if not _dialog_lock.acquire(blocking=False):
        raise BadRequestError("ファイル選択のダイアログがすでに開いています。先にそちらを閉じてください。")
    try:
        with unexpected_errors_as("フォルダ選択のダイアログを開けませんでした。"):
            selected = _ask_directory(folder)
    finally:
        _dialog_lock.release()
    return str(Path(selected)) if selected else None


def pick_image_file(initial_dir: str | None) -> tuple[str, bytes] | None:
    """Lets the user choose an image in the dialog; returns its name and bytes, or None when cancelled.

    The dialog opens in ``initial_dir``, or in the project folder (``settings.project_dir``) when it is empty.
    """
    folder = normalize_folder(initial_dir) or settings.project_dir
    if not _dialog_lock.acquire(blocking=False):
        raise BadRequestError("ファイル選択のダイアログがすでに開いています。先にそちらを閉じてください。")
    try:
        with unexpected_errors_as("ファイル選択のダイアログを開けませんでした。"):
            selected = _ask_open_filename(folder)
    finally:
        _dialog_lock.release()
    if not selected:
        return None
    path = Path(selected)
    if path.suffix.lower() not in IMAGE_SUFFIXES:
        raise BadRequestError(f"画像ファイルではありません: {path.name}")
    with unexpected_errors_as(f"画像を読み込めませんでした: {path.name}"):
        return path.name, path.read_bytes()
