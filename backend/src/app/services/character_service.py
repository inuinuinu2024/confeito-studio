"""Characters the user registers, shared by every tool (docs/specs/character-manager.md).

Kept in ``assets/characters/`` (not in git)::

    characters.json   {"categories": ["主要キャラ"],
                       "characters": [{"id": "<hex>", "name": "花子", "category": "主要キャラ",
                                       "text": "...", "images": ["<hex>.png", ...],
                                       "icon": "icon-<hex>.png" | null}, ...]}
    <character id>/   the character's images, named "<hex><ext>" and ordered by ``images``, and its icon
                      (a 256x256 PNG shown in the lists; never one of the images, so tools do not send it)

The categories and the order work like the registered prompts (categorized_store.py). The file can be
edited outside the app, so every call reads it again (``_load``): entries without a usable id / name are
skipped and image names that are invalid or have no file are dropped (both disappear on the next write).
Files and folders the JSON does not mention are left alone. ``characters.json`` is written atomically;
new image files are written before it and removed image files deleted after it.

Export / import use a zip of the same layout (``characters.json`` + ``<id>/<image>``).
"""

import io
import json
import re
import shutil
import zipfile
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any, Literal

from PIL import Image, UnidentifiedImageError

from ..config import settings
from ..errors import AppError, BadRequestError, NotFoundError, exception_text
from .categorized_store import (
    CategorizedStore,
    new_id,
    stored_categories,
    stored_category,
    validated_category,
)
from .json_file import read_or_move_aside, write_json_atomic

Character = dict[str, Any]
OnConflict = Literal["overwrite", "rename", "skip"]
#: What a create / update does with the icon: keep the saved one, remove it, or use the uploaded one.
IconAction = Literal["keep", "none", "upload"]

EXPORT_FORMAT = "confeito-characters"
ICON_SIZE = 256
# Character ids are folder names and image names file names: no separators, dots or reserved names.
_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
_IMAGE_NAME_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}\.(png|jpg|jpeg|webp)$")
_ICON_NAME_RE = re.compile(r"^icon-[A-Za-z0-9_-]{1,64}\.png$")
# Pillow format -> extension of the saved file.
_EXTENSIONS = {"PNG": ".png", "JPEG": ".jpg", "WEBP": ".webp"}
MEDIA_TYPES = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp"}


class CharacterFileError(AppError):
    pass


@dataclass
class Store(CategorizedStore):
    noun = "キャラクター"

    @property
    def characters(self) -> list[Character]:
        return self.items


@dataclass
class Upload:
    """A new image sent with a create / update (``data.images`` refers to it by index)."""

    filename: str
    data: bytes


@dataclass
class CharacterResult:
    character: Character
    warnings: list[str] = field(default_factory=list)


@dataclass
class ImportPreview:
    count: int = 0
    conflicts: int = 0
    invalid: int = 0
    warnings: list[str] = field(default_factory=list)


@dataclass
class ImportResult:
    added: int = 0
    overwritten: int = 0
    skipped: int = 0
    invalid: int = 0
    skipped_images: int = 0
    warnings: list[str] = field(default_factory=list)


def _folder(character_id: str) -> Path:
    return settings.characters_dir / character_id


def _valid_id(value: Any) -> bool:
    return isinstance(value, str) and bool(_ID_RE.match(value))


def _valid_image_name(value: Any) -> bool:
    return isinstance(value, str) and bool(_IMAGE_NAME_RE.match(value))


def _valid_icon_name(value: Any) -> bool:
    return isinstance(value, str) and bool(_ICON_NAME_RE.match(value))


def image_extension(data: bytes) -> str | None:
    """The extension for PNG / JPEG / WebP data (by content), or None for anything else."""
    try:
        with Image.open(io.BytesIO(data)) as img:
            return _EXTENSIONS.get(img.format or "")
    except (UnidentifiedImageError, OSError, ValueError):
        return None


def icon_png(data: bytes) -> bytes | None:
    """The image as a ICON_SIZE x ICON_SIZE PNG (the centre square when it is not square), or None when unreadable."""
    try:
        with Image.open(io.BytesIO(data)) as img:
            img = img.convert("RGBA")
    except (UnidentifiedImageError, OSError, ValueError):
        return None
    side = min(img.width, img.height)
    if img.width != img.height:
        left, top = (img.width - side) // 2, (img.height - side) // 2
        img = img.crop((left, top, left + side, top + side))
    if side != ICON_SIZE:
        img = img.resize((ICON_SIZE, ICON_SIZE), Image.Resampling.LANCZOS)
    buffer = io.BytesIO()
    img.save(buffer, format="PNG")
    return buffer.getvalue()


# ── File ──


def _load() -> Store:
    store = Store()
    data = read_or_move_aside(
        settings.characters_file, "キャラクターファイル", "登録キャラクターなしで読み込みました", store.warnings
    )
    store.categories = stored_categories(data.get("categories"))
    items = data.get("characters")
    if isinstance(items, list):
        for item in items:
            if not isinstance(item, dict) or not _valid_id(item.get("id")) or not isinstance(item.get("name"), str):
                continue
            folder = _folder(item["id"])
            images = item.get("images")
            text = item.get("text")
            icon = item.get("icon")
            store.items.append(
                {
                    "id": item["id"],
                    "name": item["name"],
                    "category": stored_category(item.get("category")),
                    "text": text if isinstance(text, str) else "",
                    "images": [
                        name
                        for name in dict.fromkeys(images if isinstance(images, list) else [])
                        if _valid_image_name(name) and (folder / name).is_file()
                    ],
                    "icon": icon if _valid_icon_name(icon) and (folder / icon).is_file() else None,
                }
            )
    store.normalize()
    return store


def _save(store: Store) -> None:
    store.normalize()
    write_json_atomic(
        settings.characters_file,
        {"categories": store.categories, "characters": store.characters},
        "キャラクターを保存できませんでした。",
    )


def _write_image(character_id: str, data: bytes, extension: str, prefix: str = "") -> str:
    """Writes a new image file into the character's folder; returns its name."""
    folder = _folder(character_id)
    name = f"{prefix}{new_id()}{extension}"
    try:
        folder.mkdir(parents=True, exist_ok=True)
        (folder / name).write_bytes(data)
    except OSError as e:
        raise CharacterFileError("キャラクターの画像を保存できませんでした。", raw_response=exception_text(e)) from e
    return name


def _write_icon(character_id: str, png: bytes) -> str:
    return _write_image(character_id, png, ".png", "icon-")


def _remove_images(character_id: str, names: list[str]) -> None:
    """Deletes image files no longer used (already gone from characters.json, so a failure is ignored),
    and the folder when nothing is left in it."""
    folder = _folder(character_id)
    try:
        for name in names:
            (folder / name).unlink(missing_ok=True)
        if folder.is_dir() and not any(folder.iterdir()):
            folder.rmdir()
    except OSError:
        pass


def _remove_folder(store: Store, character_id: str) -> None:
    folder = _folder(character_id)
    if not folder.exists():
        return
    try:
        shutil.rmtree(folder)
    except OSError:
        store.warnings.append(f"キャラクターの画像フォルダ（{character_id}）を削除できませんでした。")


# ── Create / update ──


@dataclass
class Fields:
    """What a create / update sends besides the uploaded files."""

    name: str
    category: str
    text: str
    images: list[Any]
    icon: IconAction = "keep"


def parse_fields(data: str) -> Fields:
    """The JSON sent with a create / update: ``{name, category, text, images, icon}``."""
    try:
        fields = json.loads(data)
    except ValueError as e:
        raise BadRequestError("キャラクターの内容が正しくありません。", raw_response=exception_text(e)) from e
    if not isinstance(fields, dict):
        raise BadRequestError("キャラクターの内容が正しくありません。")
    texts = [fields.get(k, "") for k in ("name", "category", "text")]
    images = fields.get("images", [])
    icon = fields.get("icon", "keep")
    if (
        not all(isinstance(v, str) for v in texts)
        or not isinstance(images, list)
        or icon not in ("keep", "none", "upload")
    ):
        raise BadRequestError("キャラクターの内容が正しくありません。")
    return Fields(texts[0], texts[1], texts[2], images, icon)


def _uploaded_icon(action: IconAction, icon: bytes | None) -> bytes | None:
    """The new icon as a PNG for "upload" (400 when missing or unreadable), else None."""
    if action != "upload":
        return None
    if icon is None:
        raise BadRequestError("アイコンの画像がありません。")
    png = icon_png(icon)
    if png is None:
        raise BadRequestError("アイコンを画像として読めません。")
    return png


def _validated_fields(name: str, category: str, text: str) -> tuple[str, str, str]:
    return Store().validated_name(name), validated_category(category), text


def _upload_extensions(uploads: list[Upload]) -> list[str]:
    """The extension of every upload; 400 when one is not a PNG / JPEG / WebP image."""
    extensions = []
    for upload in uploads:
        extension = image_extension(upload.data)
        if extension is None:
            raise BadRequestError(f"PNG / JPEG / WebP の画像ではありません（{upload.filename}）。")
        extensions.append(extension)
    return extensions


def _resolve_images(
    character_id: str, refs: list[Any], current: list[str], uploads: list[Upload], extensions: list[str]
) -> tuple[list[str], list[str]]:
    """Writes the uploads ``refs`` use and returns (the images in order, the new files written).

    A ``{"file": name}`` ref must be one of the character's ``current`` images.
    """
    images: list[str] = []
    written: list[str] = []
    try:
        for ref in refs:
            if isinstance(ref, dict) and isinstance(ref.get("file"), str):
                if ref["file"] not in current:
                    raise NotFoundError(f"画像「{ref['file']}」が見つかりません（削除された可能性があります）。")
                images.append(ref["file"])
            elif isinstance(ref, dict) and isinstance(ref.get("upload"), int) and 0 <= ref["upload"] < len(uploads):
                i = ref["upload"]
                name = _write_image(character_id, uploads[i].data, extensions[i])
                written.append(name)
                images.append(name)
            else:
                raise BadRequestError(
                    "画像の指定が正しくありません。", raw_response=json.dumps(ref, ensure_ascii=False)
                )
    except AppError:
        _remove_images(character_id, written)
        raise
    return list(dict.fromkeys(images)), written


def list_characters() -> Store:
    return _load()


def create_character(fields: Fields, uploads: list[Upload], icon: bytes | None = None) -> CharacterResult:
    """Registers a new character (with its uploaded images and icon) at the end of its category."""
    name, category, text = _validated_fields(fields.name, fields.category, fields.text)
    extensions = _upload_extensions(uploads)
    png = _uploaded_icon(fields.icon, icon)
    store = _load()
    store.check_unique(name)
    character_id = new_id()
    images, _written = _resolve_images(character_id, fields.images, [], uploads, extensions)
    icon_name = _write_icon(character_id, png) if png else None
    character = {
        "id": character_id,
        "name": name,
        "category": category,
        "text": text,
        "images": images,
        "icon": icon_name,
    }
    store.items.append(character)
    try:
        _save(store)
    except AppError:
        _remove_folder(store, character_id)
        raise
    return CharacterResult(character, store.warnings)


def update_character(
    character_id: str, fields: Fields, uploads: list[Upload], icon: bytes | None = None
) -> CharacterResult:
    """Replaces the fields, the images (kept, new and their order) and the icon; unused files are deleted."""
    name, category, text = _validated_fields(fields.name, fields.category, fields.text)
    extensions = _upload_extensions(uploads)
    png = _uploaded_icon(fields.icon, icon)
    store = _load()
    i = store.find(character_id)
    store.check_unique(name, character_id)
    current = store.items[i]["images"]
    current_icon = store.items[i]["icon"]
    images, written = _resolve_images(character_id, fields.images, current, uploads, extensions)
    icon_name = current_icon if fields.icon == "keep" else None
    if png:
        icon_name = _write_icon(character_id, png)
        written.append(icon_name)
    character = {
        "id": character_id,
        "name": name,
        "category": category,
        "text": text,
        "images": images,
        "icon": icon_name,
    }
    store.replace(i, character)
    try:
        _save(store)
    except AppError:
        _remove_images(character_id, written)
        raise
    unused = [n for n in current if n not in images]
    if current_icon and current_icon != icon_name:
        unused.append(current_icon)
    _remove_images(character_id, unused)
    return CharacterResult(character, store.warnings)


def move_character(character_id: str, category: str) -> CharacterResult:
    """Moves a character to the end of ``category``."""
    category = validated_category(category)
    store = _load()
    i = store.find(character_id)
    character = {**store.items[i], "category": category}
    store.replace(i, character)
    _save(store)
    return CharacterResult(character, store.warnings)


def delete_character(character_id: str) -> list[str]:
    """Removes a character and its image folder."""
    store = _load()
    del store.items[store.find(character_id)]
    _save(store)
    _remove_folder(store, character_id)
    return store.warnings


def duplicate_character(character_id: str) -> CharacterResult:
    """Copies a character (and its image / icon files) as "<name> のコピー" (or " (2)"…) right after it."""
    store = _load()
    i = store.find(character_id)
    source = store.items[i]
    copy_id = new_id()
    images = []
    icon_name = None
    try:
        for name in source["images"]:
            extension = Path(name).suffix
            images.append(_write_image(copy_id, (_folder(character_id) / name).read_bytes(), extension))
        if source["icon"]:
            icon_name = _write_icon(copy_id, (_folder(character_id) / source["icon"]).read_bytes())
    except OSError as e:
        _remove_folder(store, copy_id)
        raise CharacterFileError("キャラクターの画像をコピーできませんでした。", raw_response=exception_text(e)) from e
    copy = {
        **source,
        "id": copy_id,
        "name": store.free_name(source["name"], " のコピー"),
        "images": images,
        "icon": icon_name,
    }
    store.items.insert(i + 1, copy)
    try:
        _save(store)
    except AppError:
        _remove_folder(store, copy_id)
        raise
    return CharacterResult(copy, store.warnings)


def reorder_characters(category: str, ids: list[str]) -> list[str]:
    store = _load()
    store.reorder_items(category, ids)
    _save(store)
    return store.warnings


def reorder_categories(categories: list[str]) -> list[str]:
    store = _load()
    store.reorder_categories(categories)
    _save(store)
    return store.warnings


def rename_category(old: str, new: str) -> list[str]:
    store = _load()
    if store.rename_category(old, new):
        _save(store)
    return store.warnings


def image_path(character_id: str, name: str) -> Path:
    """The file of one of the character's images (404 when it is not one of them)."""
    store = _load()
    character = store.items[store.find(character_id)]
    if name not in character["images"]:
        raise NotFoundError(f"画像「{name}」が見つかりません（削除された可能性があります）。")
    return _folder(character_id) / name


def icon_path(character_id: str) -> Path:
    """The character's icon file (404 when it has none)."""
    store = _load()
    character = store.items[store.find(character_id)]
    if not character["icon"]:
        raise NotFoundError("アイコンがありません。")
    return _folder(character_id) / character["icon"]


# ── Export / import ──


def export_zip() -> tuple[str, bytes]:
    """The download name and a zip of every character (characters.json + <id>/<image>)."""
    store = _load()
    buffer = io.BytesIO()
    try:
        with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
            data = {
                "format": EXPORT_FORMAT,
                "version": 1,
                "categories": store.categories,
                "characters": store.characters,
            }
            zf.writestr("characters.json", json.dumps(data, ensure_ascii=False, indent=2) + "\n")
            for character in store.characters:
                for name in [*character["images"], *([character["icon"]] if character["icon"] else [])]:
                    # Images are already compressed.
                    zf.write(_folder(character["id"]) / name, f"{character['id']}/{name}", zipfile.ZIP_STORED)
    except OSError as e:
        raise CharacterFileError("キャラクターを書き出せませんでした。", raw_response=exception_text(e)) from e
    return f"confeito-characters-{datetime.now().strftime('%Y%m%d_%H%M%S')}.zip", buffer.getvalue()


@dataclass
class _ImportEntry:
    name: str
    category: str
    text: str
    #: Image data read from the zip, with its extension.
    images: list[tuple[bytes, str]]
    #: The icon as a 256x256 PNG.
    icon: bytes | None
    skipped_images: int


def _open_import(data: bytes) -> tuple[zipfile.ZipFile, list[Any], list[Any]]:
    """The zip, its characters and categories; 400 for a file that is not such a zip."""
    try:
        zf = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile as e:
        raise BadRequestError("zip として読めないファイルです。", raw_response=exception_text(e)) from e
    try:
        raw = zf.read("characters.json")
    except KeyError as e:
        raise BadRequestError("キャラクターの一覧（characters.json）がない zip です。") from e
    try:
        listing = json.loads(raw.decode("utf-8-sig"))
    except ValueError as e:
        raise BadRequestError("characters.json を JSON として読めません。", raw_response=exception_text(e)) from e
    if not isinstance(listing, dict) or not isinstance(listing.get("characters"), list):
        raise BadRequestError("characters.json にキャラクターの一覧（characters）がありません。")
    categories = listing.get("categories")
    return zf, listing["characters"], categories if isinstance(categories, list) else []


def _import_name(store: Store, item: Any) -> str | None:
    if not isinstance(item, dict) or not isinstance(item.get("name"), str):
        return None
    try:
        return store.validated_name(item["name"])
    except BadRequestError:
        return None


def _import_entry(store: Store, zf: zipfile.ZipFile, item: Any) -> _ImportEntry | None:
    """The validated entry of an imported item with its images, or None when it cannot be registered."""
    name = _import_name(store, item)
    if name is None:
        return None
    try:
        category = validated_category(item.get("category") if isinstance(item.get("category"), str) else "")
    except BadRequestError:
        return None
    text = item.get("text") if isinstance(item.get("text"), str) else ""
    refs = item.get("images") if isinstance(item.get("images"), list) else []

    def read(ref: Any, valid: bool) -> bytes | None:
        if not valid or not _valid_id(item.get("id")):
            return None
        try:
            return zf.read(f"{item['id']}/{ref}")
        except KeyError:
            return None

    images: list[tuple[bytes, str]] = []
    skipped = 0
    for ref in refs:
        data = read(ref, _valid_image_name(ref))
        extension = image_extension(data) if data is not None else None
        if data is None or extension is None:
            skipped += 1
        else:
            images.append((data, extension))
    icon = None
    if item.get("icon") is not None:
        data = read(item["icon"], _valid_icon_name(item["icon"]))
        icon = icon_png(data) if data is not None else None
        if icon is None:
            skipped += 1
    return _ImportEntry(name, category, text, images, icon, skipped)


def preview_import(data: bytes) -> ImportPreview:
    """How many characters the zip has, how many names are taken (registered or earlier in the file), how many are invalid."""
    zf, items, _categories = _open_import(data)
    store = _load()
    result = ImportPreview(count=len(items), warnings=store.warnings)
    names = store.names()
    for item in items:
        name = _import_name(store, item)
        if name is None:
            result.invalid += 1
            continue
        if name in names:
            result.conflicts += 1
        names.add(name)
    zf.close()
    return result


def import_zip(data: bytes, on_conflict: OnConflict) -> ImportResult:
    """Adds the characters of a zip; names already taken are overwritten, renamed or skipped."""
    zf, items, categories = _open_import(data)
    store = _load()
    result = ImportResult(warnings=store.warnings)
    store.add_categories(categories)
    written: list[tuple[str, list[str]]] = []
    removed: list[tuple[str, list[str]]] = []

    def write_all(character_id: str, entry: _ImportEntry) -> tuple[list[str], str | None]:
        """Writes the images and the icon; returns their names."""
        names = [_write_image(character_id, image, extension) for image, extension in entry.images]
        icon = _write_icon(character_id, entry.icon) if entry.icon else None
        written.append((character_id, [*names, *([icon] if icon else [])]))
        return names, icon

    try:
        with zf:
            for item in items:
                entry = _import_entry(store, zf, item)
                if entry is None:
                    result.invalid += 1
                    continue
                taken = entry.name in store.names()
                if taken and on_conflict == "skip":
                    result.skipped += 1
                    continue
                result.skipped_images += entry.skipped_images
                if taken and on_conflict == "overwrite":
                    i = store.index_of_name(entry.name)
                    old = store.items[i]
                    images, icon = write_all(old["id"], entry)
                    removed.append((old["id"], [*old["images"], *([old["icon"]] if old["icon"] else [])]))
                    store.replace(
                        i, {**old, "category": entry.category, "text": entry.text, "images": images, "icon": icon}
                    )
                    result.overwritten += 1
                else:
                    character_id = new_id()
                    name = store.free_name(entry.name) if taken else entry.name
                    images, icon = write_all(character_id, entry)
                    store.items.append(
                        {
                            "id": character_id,
                            "name": name,
                            "category": entry.category,
                            "text": entry.text,
                            "images": images,
                            "icon": icon,
                        }
                    )
                    result.added += 1
            if result.added or result.overwritten:
                _save(store)
    except AppError:
        for character_id, names in written:
            _remove_images(character_id, names)
        raise
    for character_id, names in removed:
        _remove_images(character_id, names)
    return result
