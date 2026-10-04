"""The ARCHIVES folder the user chooses (保存先; services/archives_location.py)."""

import json
from pathlib import Path

import pytest

from src.app.config import PROJECT_ROOT, settings
from src.app.errors import BadRequestError
from src.app.services import archive_service, archives_location, file_dialog_service


def saved_value(data_dir: Path) -> str | None:
    path = data_dir / "settings" / "user_settings.json"
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8")).get(archives_location.SETTING_KEY)


def test_default_is_the_project_archives_folder(archives_dir: Path) -> None:
    status = archives_location.status()
    assert status == {
        "path": str(archives_dir),
        "default_path": str(archives_dir),
        "is_default": True,
        "exists": True,
        "ignored": None,
    }


def test_switching_shows_the_other_folder_and_moves_nothing(data_dir: Path, archives_dir: Path) -> None:
    (archives_dir / "old-archive").mkdir()
    other = data_dir / "elsewhere"
    (other / "new-archive").mkdir(parents=True)

    result = archives_location.change(str(other))

    assert result["changed"] and not result["missing"] and not result["is_default"]
    assert result["path"] == str(other.resolve())
    assert [a["key"] for a in archive_service.list_archives()] == ["new-archive"]
    assert (archives_dir / "old-archive").is_dir()  # left where it was
    assert saved_value(data_dir) == str(other.resolve())

    # Back to the default: its archives show again.
    back = archives_location.change("")
    assert back["is_default"] and back["changed"]
    assert [a["key"] for a in archive_service.list_archives()] == ["old-archive"]
    assert saved_value(data_dir) == ""


def test_quoted_paths_from_explorer_are_accepted(data_dir: Path) -> None:
    other = data_dir / "quoted"
    other.mkdir()
    assert archives_location.change(f'  "{other}"  ')["path"] == str(other.resolve())


def test_a_missing_folder_is_created_only_when_asked(data_dir: Path, archives_dir: Path) -> None:
    target = data_dir / "new" / "archives"

    asked = archives_location.change(str(target))

    assert asked["missing"] and not asked["changed"] and not target.exists()
    assert asked["requested_path"] == str(target.resolve())
    assert settings.archives_dir == archives_dir

    created = archives_location.change(str(target), create=True)

    assert created["changed"] and target.is_dir()
    assert settings.archives_dir == target.resolve()


def test_the_default_folder_is_created_without_asking(data_dir: Path, archives_dir: Path) -> None:
    other = data_dir / "other"
    other.mkdir()
    archives_location.change(str(other))
    archives_dir.rmdir()

    result = archives_location.change("")

    assert result["is_default"] and not result["missing"] and archives_dir.is_dir()


@pytest.mark.parametrize(
    ("path", "message"),
    [
        ("relative\\archives", "フルパス"),
        (str(PROJECT_ROOT), "アプリのフォルダ"),
        (str(PROJECT_ROOT.parent), "アプリのフォルダ"),
        (str(PROJECT_ROOT / "frontend"), "アプリのフォルダ"),
    ],
)
def test_refused_folders(path: str, message: str, archives_dir: Path) -> None:
    with pytest.raises(BadRequestError, match=message):
        archives_location.change(path)
    assert settings.archives_dir == archives_dir


def test_a_file_is_refused(data_dir: Path) -> None:
    file = data_dir / "a.txt"
    file.write_text("x", encoding="utf-8")
    with pytest.raises(BadRequestError, match="ファイルです"):
        archives_location.change(str(file))


def test_startup_applies_the_saved_folder(data_dir: Path) -> None:
    other = data_dir / "saved"
    other.mkdir()
    archives_location.change(str(other))
    settings.use_archives_dir(None)  # as after a restart

    archives_location.load()

    assert settings.archives_dir == other.resolve()


def test_startup_ignores_a_saved_folder_it_cannot_use(data_dir: Path, archives_dir: Path) -> None:
    settings_file = data_dir / "settings" / "user_settings.json"
    settings_file.parent.mkdir(parents=True, exist_ok=True)
    settings_file.write_text(json.dumps({archives_location.SETTING_KEY: "relative"}), encoding="utf-8")

    archives_location.load()

    assert settings.archives_dir == archives_dir
    assert "既定のフォルダを使っています" in archives_location.status()["ignored"]


def test_routes(client, data_dir: Path) -> None:
    assert client.get("/api/settings/archives").json()["is_default"] is True
    missing = client.post("/api/settings/archives", json={"path": str(data_dir / "x")}).json()
    assert missing["missing"] is True
    created = client.post("/api/settings/archives", json={"path": str(data_dir / "x"), "create": True}).json()
    assert created["changed"] is True and created["exists"] is True
    refused = client.post("/api/settings/archives", json={"path": "relative"})
    assert refused.status_code == 400


def test_pick_folder(client, monkeypatch: pytest.MonkeyPatch, data_dir: Path) -> None:
    opened_in: list[Path] = []

    def ask(initial: Path) -> str:
        opened_in.append(initial)
        return str(data_dir / "picked")

    monkeypatch.setattr(file_dialog_service, "_ask_directory", ask)
    res = client.post("/api/local-files/pick-folder", json={"initial_dir": str(data_dir)})
    assert res.json() == {"path": str(data_dir / "picked")}
    assert opened_in == [data_dir]

    monkeypatch.setattr(file_dialog_service, "_ask_directory", lambda initial: "")
    assert client.post("/api/local-files/pick-folder", json={"initial_dir": "missing"}).json() == {"path": None}
