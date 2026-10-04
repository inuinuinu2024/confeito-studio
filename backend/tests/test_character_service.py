"""Registered characters shared by every tool (assets/characters/)."""

import io
import json
import zipfile
from pathlib import Path

import pytest
from PIL import Image

from src.app.errors import BadRequestError, ConflictError, NotFoundError
from src.app.services import character_service as svc

from .conftest import make_png


@pytest.fixture
def characters_dir(data_dir: Path) -> Path:
    return data_dir / "assets" / "characters"


def make_jpeg() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (4, 4), (0, 0, 255)).save(buf, format="JPEG")
    return buf.getvalue()


def create_c(name, category, text, refs, uploads, icon_action="keep", icon=None):
    return svc.create_character(svc.Fields(name, category, text, refs, icon_action), uploads, icon)


def update_c(character_id, name, category, text, refs, uploads, icon_action="keep", icon=None):
    return svc.update_character(character_id, svc.Fields(name, category, text, refs, icon_action), uploads, icon)


def upload(data: bytes | None = None, name: str = "a.png") -> svc.Upload:
    return svc.Upload(name, data if data is not None else make_png(4, 4))


def create(name: str, category: str = "", text: str = "", images: int = 0) -> dict:
    uploads = [upload() for _ in range(images)]
    refs = [{"upload": i} for i in range(images)]
    return create_c(name, category, text, refs, uploads).character


def names() -> list[str]:
    return [c["name"] for c in svc.list_characters().characters]


def read(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def test_create_writes_the_images_into_the_character_folder(characters_dir: Path) -> None:
    jpeg = make_jpeg()
    a = create_c(" 花子 ", "主要", "黒髪", [{"upload": 1}, {"upload": 0}], [upload(), upload(jpeg, "b.jpg")]).character

    assert (a["name"], a["category"], a["text"]) == ("花子", "主要", "黒髪")
    assert [Path(n).suffix for n in a["images"]] == [".jpg", ".png"]
    assert (characters_dir / a["id"] / a["images"][0]).read_bytes() == jpeg
    assert read(characters_dir / "characters.json") == {"categories": ["主要"], "characters": [a]}
    assert not (characters_dir / "characters.json.tmp").exists()


def test_only_the_name_is_required() -> None:
    a = create("a")
    assert (a["text"], a["images"]) == ("", [])
    with pytest.raises(BadRequestError, match="名前を入力"):
        create(" ")
    with pytest.raises(BadRequestError, match="100 文字以内"):
        create("x" * 101)
    with pytest.raises(BadRequestError, match="同じ名前のキャラクター「a」"):
        create("a", "other")


def test_uploads_must_be_png_jpeg_or_webp(characters_dir: Path) -> None:
    with pytest.raises(BadRequestError, match=r"PNG / JPEG / WebP の画像ではありません（x.gif）"):
        create_c("a", "", "", [{"upload": 0}], [upload(b"GIF89a....", "x.gif")])
    with pytest.raises(BadRequestError, match="画像の指定"):
        create_c("a", "", "", [{"upload": 3}], [upload()])
    with pytest.raises(NotFoundError, match="画像「x.png」"):
        create_c("a", "", "", [{"file": "x.png"}], [])
    assert names() == []
    assert not characters_dir.exists() or not any(characters_dir.iterdir())


def test_update_keeps_reorders_adds_and_removes_images(characters_dir: Path) -> None:
    a = create("a", "主要", images=3)
    first, second, third = a["images"]
    updated = update_c(
        a["id"], "a2", "主要", "text", [{"file": third}, {"upload": 0}, {"file": first}], [upload(make_jpeg())]
    ).character

    assert updated["images"][0] == third and updated["images"][2] == first
    assert updated["images"][1].endswith(".jpg")
    folder = characters_dir / a["id"]
    assert sorted(p.name for p in folder.iterdir()) == sorted(updated["images"])
    assert not (folder / second).exists()
    with pytest.raises(NotFoundError, match=f"画像「{second}」"):
        update_c(a["id"], "a2", "", "", [{"file": second}], [])
    with pytest.raises(NotFoundError, match="キャラクターが見つかりません"):
        update_c("missing", "x", "", "", [], [])


def test_update_moves_to_the_end_only_when_the_category_changes() -> None:
    a = create("a", "主要")
    create("b", "主要")
    update_c(a["id"], "a", "主要", "changed", [], [])
    assert names() == ["a", "b"]
    update_c(a["id"], "a", "モブ", "", [], [])
    svc.move_character(a["id"], "主要")
    assert names() == ["b", "a"]


def test_delete_removes_the_folder(characters_dir: Path) -> None:
    a = create("a", images=2)
    assert svc.delete_character(a["id"]) == []
    assert not (characters_dir / a["id"]).exists()
    assert names() == []


def test_duplicate_copies_the_images_right_after() -> None:
    a = create("a", "主要", "t", images=2)
    create("b", "主要")
    copy = svc.duplicate_character(a["id"]).character
    assert copy["name"] == "a のコピー" and copy["id"] != a["id"]
    assert len(copy["images"]) == 2 and set(copy["images"]).isdisjoint(a["images"])
    assert (
        svc.image_path(copy["id"], copy["images"][0]).read_bytes()
        == svc.image_path(a["id"], a["images"][0]).read_bytes()
    )
    assert names() == ["a", "a のコピー", "b"]


def test_order_and_categories() -> None:
    a = create("a", "主要")
    b = create("b", "主要")
    create("c", "モブ")
    svc.reorder_characters("主要", [b["id"], a["id"]])
    svc.reorder_categories(["モブ", "主要"])
    assert names() == ["c", "b", "a"]
    with pytest.raises(ConflictError, match="キャラクターの一覧が変わっています"):
        svc.reorder_characters("主要", [a["id"]])
    svc.rename_category("モブ", "主要")
    store = svc.list_characters()
    assert store.categories == ["主要"]
    assert [c["name"] for c in store.characters] == ["b", "a", "c"]


def test_file_edited_outside_the_app(characters_dir: Path) -> None:
    folder = characters_dir / "abc"
    folder.mkdir(parents=True)
    (folder / "x1.png").write_bytes(make_png(2, 2))
    (folder / "unlisted.png").write_bytes(make_png(2, 2))
    data = {
        "categories": ["B"],
        "characters": [
            {"id": "abc", "name": "ok", "category": "A", "images": ["x1.png", "gone.png", "../evil.png", 3]},
            {"id": "../up", "name": "bad id"},
            {"id": "def", "name": 5},
            "junk",
            {"id": "ghi", "name": "b", "category": "B", "text": "t"},
        ],
    }
    (characters_dir / "characters.json").write_text(json.dumps(data), encoding="utf-8")

    store = svc.list_characters()
    assert store.categories == ["B", "A"]
    assert [(c["name"], c["images"]) for c in store.characters] == [("b", []), ("ok", ["x1.png"])]
    assert store.characters[1]["text"] == ""
    with pytest.raises(NotFoundError):
        svc.image_path("abc", "unlisted.png")
    assert (folder / "unlisted.png").exists()


def test_broken_file_is_moved_aside(characters_dir: Path) -> None:
    characters_dir.mkdir(parents=True)
    (characters_dir / "characters.json").write_text("{broken", encoding="utf-8")
    store = svc.list_characters()
    assert store.characters == []
    assert "characters.broken-" in store.warnings[0]
    assert len(list(characters_dir.glob("characters.broken-*.json"))) == 1


def test_export_and_import_roundtrip(characters_dir: Path) -> None:
    a = create("花子", "主要", "黒髪", images=2)
    create("太郎", "モブ")
    name, content = svc.export_zip()
    assert name.startswith("confeito-characters-") and name.endswith(".zip")
    with zipfile.ZipFile(io.BytesIO(content)) as zf:
        listing = json.loads(zf.read("characters.json"))
        assert listing["format"] == "confeito-characters"
        assert f"{a['id']}/{a['images'][0]}" in zf.namelist()

    preview = svc.preview_import(content)
    assert (preview.count, preview.conflicts, preview.invalid) == (2, 2, 0)

    skipped = svc.import_zip(content, "skip")
    assert (skipped.added, skipped.skipped) == (0, 2)
    renamed = svc.import_zip(content, "rename")
    assert renamed.added == 2
    assert names() == ["花子", "花子 (2)", "太郎", "太郎 (2)"]
    copy = svc.list_characters().characters[1]
    assert len(copy["images"]) == 2 and copy["id"] != a["id"]

    update_c(a["id"], "花子", "主要", "changed", [], [])
    overwritten = svc.import_zip(content, "overwrite")
    assert overwritten.overwritten == 2
    restored = svc.list_characters().characters[0]
    assert (restored["id"], restored["text"], len(restored["images"])) == (a["id"], "黒髪", 2)
    assert sorted(p.name for p in (characters_dir / a["id"]).iterdir()) == sorted(restored["images"])


def test_import_skips_invalid_entries_and_images() -> None:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        listing = {
            "categories": ["新"],
            "characters": [
                {"id": "a1", "name": "ok", "category": "新", "images": ["p.png", "missing.png", "t.png"]},
                {"id": "a2", "name": " "},
                {"name": "no id", "images": ["p.png"]},
            ],
        }
        zf.writestr("characters.json", json.dumps(listing))
        zf.writestr("a1/p.png", make_png(2, 2))
        zf.writestr("a1/t.png", b"not an image")
    content = buf.getvalue()

    assert svc.preview_import(content).invalid == 1
    result = svc.import_zip(content, "skip")
    assert (result.added, result.invalid, result.skipped_images) == (2, 1, 3)
    store = svc.list_characters()
    assert store.categories == ["新"]
    assert [(c["name"], len(c["images"])) for c in store.characters] == [("ok", 1), ("no id", 0)]


def test_import_rejects_files_that_are_not_such_zips() -> None:
    with pytest.raises(BadRequestError, match="zip として読めない"):
        svc.import_zip(b"plain", "skip")
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("other.json", "{}")
    with pytest.raises(BadRequestError, match="characters.json"):
        svc.preview_import(buf.getvalue())


def test_icon_is_a_256_png_apart_from_the_images(characters_dir: Path) -> None:
    a = create_c("a", "", "", [{"upload": 0}], [upload()], "upload", make_png(300, 200)).character
    assert a["icon"].startswith("icon-") and a["icon"] not in a["images"]
    with Image.open(svc.icon_path(a["id"])) as icon:
        assert (icon.format, icon.size) == ("PNG", (256, 256))
    first_icon = a["icon"]

    # keep → same file; upload → new file, the old one is deleted after saving; none → no icon.
    kept = update_c(a["id"], "a", "", "", [{"file": a["images"][0]}], []).character
    assert kept["icon"] == first_icon
    changed = update_c(a["id"], "a", "", "", [], [], "upload", make_png(256, 256)).character
    assert changed["icon"] != first_icon and changed["images"] == []
    assert not (characters_dir / a["id"] / first_icon).exists()
    copy = svc.duplicate_character(a["id"]).character
    assert copy["icon"] and copy["icon"] != changed["icon"]
    removed = update_c(a["id"], "a", "", "", [], [], "none").character
    assert removed["icon"] is None
    with pytest.raises(NotFoundError, match="アイコンがありません"):
        svc.icon_path(a["id"])
    with pytest.raises(BadRequestError, match="アイコンを画像として読めません"):
        update_c(a["id"], "a", "", "", [], [], "upload", b"text")
    with pytest.raises(BadRequestError, match="アイコンの画像がありません"):
        update_c(a["id"], "a", "", "", [], [], "upload")
    with pytest.raises(BadRequestError):
        svc.parse_fields(json.dumps({"name": "a", "icon": "other"}))
    assert svc.parse_fields(json.dumps({"name": "a"})).icon == "keep"


def test_icon_in_export_and_import(characters_dir: Path) -> None:
    a = create_c("a", "", "", [], [], "upload", make_png(256, 256)).character
    _name, content = svc.export_zip()
    with zipfile.ZipFile(io.BytesIO(content)) as zf:
        assert f"{a['id']}/{a['icon']}" in zf.namelist()
    svc.import_zip(content, "rename")
    imported = svc.list_characters().characters[1]
    assert imported["name"] == "a (2)" and imported["icon"] and imported["icon"] != a["icon"]
    overwritten = svc.import_zip(content, "overwrite")
    assert overwritten.overwritten == 1
    assert len(list((characters_dir / a["id"]).glob("icon-*.png"))) == 1


def test_missing_icon_file_means_no_icon(characters_dir: Path) -> None:
    a = create_c("a", "", "", [], [], "upload", make_png(256, 256)).character
    (characters_dir / a["id"] / a["icon"]).unlink()
    assert svc.list_characters().characters[0]["icon"] is None


def test_each_image_has_its_own_text(characters_dir: Path) -> None:
    a = create_c(
        "花子", "", "黒髪", [{"upload": 0, "text": "正面"}, {"upload": 1, "text": ""}], [upload(), upload()]
    ).character
    first, second = a["images"]
    assert a["image_texts"] == {first: "正面"}  # empty texts are not stored

    # Reordered, one text changed, one added; a removed image takes its text with it.
    b = update_c(
        a["id"],
        "花子",
        "",
        "黒髪",
        [{"file": second, "text": "横顔"}, {"upload": 0, "text": "後ろ"}],
        [upload()],
    ).character
    assert b["images"][0] == second
    assert b["image_texts"] == {second: "横顔", b["images"][1]: "後ろ"}
    assert read(characters_dir / "characters.json")["characters"][0]["image_texts"] == b["image_texts"]

    with pytest.raises(BadRequestError, match="画像の本文"):
        update_c(a["id"], "花子", "", "", [{"file": second, "text": 1}], [])


def test_image_texts_follow_duplicates_and_outside_edits(characters_dir: Path) -> None:
    a = create_c("花子", "", "", [{"upload": 0, "text": "正面"}], [upload()]).character
    copy = svc.duplicate_character(a["id"]).character
    assert copy["image_texts"] == {copy["images"][0]: "正面"}

    # Texts of images that are not in the list, and texts that are not strings, are dropped on reading.
    path = characters_dir / "characters.json"
    data = read(path)
    data["characters"][0]["image_texts"] = {a["images"][0]: "正面", "gone.png": "x", "other": 3}
    path.write_text(json.dumps(data), encoding="utf-8")
    assert svc.list_characters().characters[0]["image_texts"] == {a["images"][0]: "正面"}

    # An old file without image_texts has none.
    del data["characters"][0]["image_texts"]
    path.write_text(json.dumps(data), encoding="utf-8")
    assert svc.list_characters().characters[0]["image_texts"] == {}


def test_image_texts_in_export_and_import(characters_dir: Path) -> None:
    create_c("花子", "", "", [{"upload": 0, "text": "正面"}, {"upload": 1}], [upload(), upload()])
    _name, data = svc.export_zip()
    for character in svc.list_characters().characters:
        svc.delete_character(character["id"])

    svc.import_zip(data, "skip")

    [imported] = svc.list_characters().characters
    assert imported["image_texts"] == {imported["images"][0]: "正面"}
