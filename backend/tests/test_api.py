"""HTTP contract tests: routes, status codes and the ``{"detail": ...}`` error format
that the frontend's ``shared/api/http.ts`` relies on."""

import base64
import json
from pathlib import Path

import pytest

from src.app.providers import gemini
from src.app.providers.base import GenerationResult

from .conftest import make_png


def test_health(client) -> None:
    assert client.get("/api/health").json() == {"status": "ok", "version": "0.1.0"}


def test_startup_empties_trash(archives_dir: Path) -> None:
    from fastapi.testclient import TestClient

    from src.app.main import app

    (archives_dir / ".trash" / ".items" / "a").mkdir(parents=True)
    (archives_dir / ".trash" / ".items" / "a" / "x.png").write_bytes(b"x")
    (archives_dir / "kept").mkdir()
    with TestClient(app):  # entering runs the lifespan startup
        pass
    assert list((archives_dir / ".trash").iterdir()) == []
    assert (archives_dir / "kept").is_dir()


def test_every_response_is_no_store(client, monkeypatch: pytest.MonkeyPatch) -> None:
    from src.app.routers import archives

    client.post("/api/archives", data={"name": "arc", "paths": ["a.png"]}, files=[("files", ("a.png", b"x"))])

    def explode(*_a, **_kw):
        raise RuntimeError("boom")

    monkeypatch.setattr(archives.svc, "list_archives", explode)
    responses = [
        client.get("/api/health"),
        client.get("/api/archives/arc/extract", params={"path": "a.png"}),
        client.get("/api/archives/nope/contents"),  # AppError (404)
        client.get("/api/archives"),  # unexpected error (500)
    ]
    assert [r.status_code for r in responses] == [200, 200, 404, 500]
    assert all(r.headers["cache-control"] == "no-store" for r in responses)


def test_archive_roundtrip(client, archives_dir: Path) -> None:
    files = [
        ("files", ("a.png", make_png(4, 4), "image/png")),
        ("files", ("log.txt", b"line\n", "text/plain")),
    ]
    res = client.post("/api/archives", data={"name": "arc", "paths": ["sub/a.png", "log.txt"]}, files=files)
    assert res.json() == {"status": "success", "archive": "arc"}

    assert [a["key"] for a in client.get("/api/archives").json()] == ["arc"]
    keys = {e["key"] for e in client.get("/api/archives/arc/contents").json()}
    assert keys == {"arc/sub", "arc/sub/a.png", "arc/log.txt"}

    extracted = client.get("/api/archives/arc/extract", params={"path": "sub/a.png"})
    assert extracted.headers["content-type"] == "image/png"

    # Logging was removed (docs/specs/notifications.md): there is no log endpoint any more.
    assert client.post("/api/archives/arc/log", json={"message": "more"}).status_code == 404
    assert (archives_dir / "arc" / "log.txt").read_text(encoding="utf-8") == "line\n"

    assert client.post("/api/archives/arc/delete_contents", json={"paths": ["sub/a.png"]}).status_code == 200
    assert {e["key"] for e in client.get("/api/archives/arc/contents").json()} == {"arc/log.txt"}
    assert client.post("/api/archives/arc/restore_contents", json={"paths": ["sub/a.png"]}).status_code == 200
    assert "arc/sub/a.png" in {e["key"] for e in client.get("/api/archives/arc/contents").json()}
    assert client.post("/api/archives/arc/restore_contents", json={"paths": ["sub/a.png"]}).status_code == 404
    assert client.delete("/api/archives/arc").status_code == 200
    assert client.get("/api/archives").json() == []
    assert client.post("/api/archives/arc/restore").status_code == 200
    assert [a["key"] for a in client.get("/api/archives").json()] == ["arc"]


def test_save_result_route(client, archives_dir: Path) -> None:
    def post(**data):
        return client.post(
            "/api/archives/results",
            data={"paths": ["nobg.png"], **data},
            files=[("files", ("nobg.png", b"x"))],
        )

    info = json.dumps({"tool": "背景除去", "source": "page/page.png", "settings": {}})
    assert post(name="r", root="page", info=info).json() == {"status": "success", "folder": "page/r"}
    assert post(name="r", root="page").json()["folder"] == "page/r_2"
    assert post(name="r").json()["folder"] == "r"
    assert json.loads((archives_dir / "page" / "r" / "info.json").read_text(encoding="utf-8"))["tool"] == "背景除去"
    assert not (archives_dir / "page" / "r_2" / "info.json").exists()
    assert post(name="r", info="{").status_code == 400


def test_archive_errors_use_detail_and_status(client) -> None:
    res = client.get("/api/archives/nope/contents")
    assert res.status_code == 404
    assert res.json() == {"detail": "アーカイブ「nope」が見つかりません。"}

    client.post("/api/archives", data={"name": "arc", "paths": ["a.txt"]}, files=[("files", ("a.txt", b"x"))])
    res = client.get("/api/archives/arc/extract", params={"path": "../x"})
    assert res.status_code == 400
    assert res.json() == {"detail": {"message": "アーカイブの外を指すパスは使えません。", "raw_response": "../x"}}

    res = client.post("/api/archives", data={"name": "arc", "paths": ["a", "b"]}, files=[("files", ("a", b"x"))])
    assert res.status_code == 400
    assert res.json() == {"detail": "ファイルとパスの数が一致しません。"}


def test_tool_settings_roundtrip(client, data_dir: Path) -> None:
    assert client.get("/api/settings/tools").json() == {"values": {}, "warnings": []}
    res = client.post("/api/settings/tools", json={"values": {"nanoBananaPro_prompt": "着彩して"}})
    assert res.status_code == 200 and res.json() == {"warnings": []}
    assert client.get("/api/settings/tools").json() == {"values": {"nanoBananaPro_prompt": "着彩して"}, "warnings": []}
    # Saved as the user's settings; the initial values file is never written.
    assert (data_dir / "settings" / "user_settings.json").exists()
    assert not (data_dir / "settings" / "default_settings.json").exists()


def test_prompts_roundtrip(client) -> None:
    assert client.get("/api/prompts/nanoBananaPro").json() == {"prompts": [], "warnings": []}

    res = client.post("/api/prompts/nanoBananaPro", json={"name": " 着彩 ", "text": "着彩して"})
    assert res.status_code == 200
    prompt = res.json()["prompt"]
    assert prompt["name"] == "着彩" and prompt["text"] == "着彩して"

    duplicate = client.post("/api/prompts/nanoBananaPro", json={"name": "着彩", "text": "別"})
    assert duplicate.status_code == 400
    assert duplicate.json() == {"detail": "同じ名前のプロンプト「着彩」が登録されています。"}

    res = client.put(f"/api/prompts/nanoBananaPro/{prompt['id']}", json={"name": "着彩2", "text": "塗って"})
    assert res.json() == {"prompt": {"id": prompt["id"], "name": "着彩2", "text": "塗って"}, "warnings": []}
    assert client.get("/api/prompts/nanoBananaPro").json()["prompts"] == [res.json()["prompt"]]
    # Kept apart from the tool settings.
    assert client.get("/api/settings/tools").json() == {"values": {}, "warnings": []}

    assert client.delete(f"/api/prompts/nanoBananaPro/{prompt['id']}").json() == {"warnings": []}
    assert client.delete(f"/api/prompts/nanoBananaPro/{prompt['id']}").status_code == 404
    assert client.get("/api/prompts/nanoBananaPro").json() == {"prompts": [], "warnings": []}
    assert client.get("/api/prompts/bad-name").status_code == 400


def test_save_gemini_key_preserves_other_env_lines(client, data_dir: Path) -> None:
    env_file = data_dir / ".env"
    env_file.write_text("# comment\nGEMINI_API_KEY=old\nU2NET_HOME=models\n", encoding="utf-8")

    assert client.get("/api/settings/gemini").json() == {"has_key": False}
    assert client.post("/api/settings/gemini", json={"api_key": " new-key "}).status_code == 200

    assert env_file.read_text(encoding="utf-8") == "# comment\nGEMINI_API_KEY=new-key\nU2NET_HOME=models\n"
    assert client.get("/api/settings/gemini").json() == {"has_key": True}


NBP_PAYLOAD = {
    "model": "gemini-3-pro-image",
    "input": [{"type": "text", "text": "hi"}],
    "response_format": {"type": "image", "mime_type": "image/png"},
}


def test_nano_banana_pro_without_key_is_bad_request(client) -> None:
    res = client.post("/api/nano-banana-pro", json=NBP_PAYLOAD)
    assert res.status_code == 400
    assert res.json() == {"detail": gemini.MISSING_API_KEY_MESSAGE}


def test_nano_banana_pro_success(client, monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[tuple[str, dict]] = []

    async def fake(self, payload, api_key=None, api="interactions"):
        calls.append((api, payload))
        return GenerationResult(image_bytes=b"IMG", width=1, height=1, metadata={"model": payload["model"]})

    monkeypatch.setattr(gemini.GeminiProvider, "generate_multimodal", fake)

    res = client.post("/api/nano-banana-pro", json={**NBP_PAYLOAD, "safetySettings": []})
    assert res.content == b"IMG" and res.headers["content-type"] == "image/png"
    assert calls == [("interactions", NBP_PAYLOAD)]  # unknown fields are dropped by the request model


def test_nano_banana_pro_forwards_interactions_options(client, monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[dict] = []

    async def fake(self, payload, api_key=None, api="interactions"):
        calls.append(payload)
        return GenerationResult(image_bytes=b"IMG", width=1, height=1, mime_type="image/jpeg")

    monkeypatch.setattr(gemini.GeminiProvider, "generate_multimodal", fake)
    options = {
        "generation_config": {"thinking_level": "high", "seed": 7},
        "system_instruction": "draw",
        "tools": [{"type": "google_search", "search_types": ["web_search"]}],
        "store": False,
        "service_tier": "flex",
    }

    res = client.post("/api/nano-banana-pro", json={**NBP_PAYLOAD, **options, "background": True})

    assert calls == [{**NBP_PAYLOAD, **options}]
    # The image's own MIME type wins over the requested one.
    assert res.headers["content-type"] == "image/jpeg"


def test_generate_content_route_forwards_native_body(client, monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[tuple[str, dict]] = []

    async def fake(self, payload, api_key=None, api="interactions"):
        calls.append((api, payload))
        return GenerationResult(image_bytes=b"IMG", width=1, height=1, mime_type="image/png")

    monkeypatch.setattr(gemini.GeminiProvider, "generate_multimodal", fake)
    body = {
        "model": "gemini-3-pro-image",
        "contents": [{"role": "user", "parts": [{"text": "hi"}]}],
        "generationConfig": {"imageConfig": {"imageSize": "1K"}},
        "safetySettings": [{"category": "HARM_CATEGORY_HARASSMENT", "threshold": "OFF"}],
        "systemInstruction": {"parts": [{"text": "draw"}]},
        "tools": [{"googleSearch": {}}],
        "serviceTier": "flex",
        "store": False,
    }

    res = client.post("/api/nano-banana-pro/generate-content", json={**body, "cachedContent": "x"})

    assert res.status_code == 200 and res.content == b"IMG"
    assert calls == [("generate_content", body)]


class FakeResponse:
    def __init__(self, status_code: int, body: dict) -> None:
        self.status_code = status_code
        self.text = json.dumps(body)
        self.headers = {"Content-Type": "application/json"}
        self._body = body

    def json(self) -> dict:
        return self._body


def test_generate_content_returns_the_final_image(client, monkeypatch: pytest.MonkeyPatch) -> None:
    final = make_png(2, 2)
    response = {
        "candidates": [
            {
                "content": {
                    "parts": [
                        {"inlineData": {"mimeType": "image/png", "data": "dGhvdWdodA=="}, "thought": True},
                        {"text": "here you go"},
                        {"inlineData": {"mimeType": "image/png", "data": base64.b64encode(final).decode()}},
                    ]
                },
                "finishReason": "STOP",
            }
        ]
    }
    requests_seen: list[tuple[str, dict]] = []

    def fake_post(url, **kwargs):
        requests_seen.append((url, kwargs["json"]))
        return FakeResponse(200, response)

    monkeypatch.setenv("GEMINI_API_KEY", "k")
    monkeypatch.setattr(gemini.requests, "post", fake_post)

    res = client.post(
        "/api/nano-banana-pro/generate-content",
        json={"model": "gemini-3-pro-image", "contents": [{"parts": [{"text": "hi"}]}]},
    )

    assert res.status_code == 200
    assert res.content == final and res.headers["content-type"] == "image/png"
    url, body = requests_seen[0]
    assert url.endswith("/models/gemini-3-pro-image:generateContent")
    assert body == {"contents": [{"parts": [{"text": "hi"}]}]}


@pytest.mark.parametrize(
    ("response", "message", "summary"),
    [
        (
            {"promptFeedback": {"blockReason": "PROHIBITED_CONTENT"}},
            "入力がブロックされたため、画像は生成されませんでした（blockReason: PROHIBITED_CONTENT）。"
            "入力が Google の利用ポリシーで禁止されている内容と判定されました。"
            "安全設定では解除できません。プロンプトや参照画像を変えてください。",
            "blockReason: PROHIBITED_CONTENT",
        ),
        (
            {"candidates": [{"content": {"parts": [{"text": "no"}]}, "finishReason": "IMAGE_SAFETY"}]},
            "画像が生成されませんでした（finishReason: IMAGE_SAFETY）。生成された画像が安全フィルタによりブロックされました。"
            "generateContent API の安全設定を緩めると通ることがあります。通らなければプロンプトや参照画像を変えてください。",
            "finishReason: IMAGE_SAFETY\ntext: no",
        ),
    ],
)
def test_generate_content_without_image_explains_why(
    client, monkeypatch: pytest.MonkeyPatch, response: dict, message: str, summary: str
) -> None:
    """Gemini answered without an image: 422 (not a server failure), a Japanese explanation, and the
    reason fields above Gemini's response in raw_response."""
    monkeypatch.setenv("GEMINI_API_KEY", "k")
    monkeypatch.setattr(gemini.requests, "post", lambda *a, **kw: FakeResponse(200, response))

    res = client.post(
        "/api/nano-banana-pro/generate-content",
        json={"model": "gemini-3-pro-image", "contents": [{"parts": [{"text": "hi"}]}]},
    )

    assert res.status_code == 422
    assert res.json() == {
        "detail": {
            "message": message,
            "raw_response": f"{summary}\n\n{json.dumps(response, ensure_ascii=False, indent=2)}",
        }
    }


def test_nano_banana_pro_api_error_carries_raw_response(client, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GEMINI_API_KEY", "k")
    monkeypatch.setattr(gemini.requests, "post", lambda *a, **kw: FakeResponse(400, {"error": {"message": "blocked"}}))

    res = client.post("/api/nano-banana-pro", json=NBP_PAYLOAD)

    assert res.status_code == 500
    assert res.json() == {
        "detail": {
            "message": "Gemini API がエラーを返しました（HTTP 400）。",
            "raw_response": {"error": {"message": "blocked"}},
        }
    }


def test_nano_banana_pro_network_error_keeps_the_exception_text(client, monkeypatch: pytest.MonkeyPatch) -> None:
    def fail(*_a, **_kw):
        raise gemini.requests.exceptions.ConnectionError("connection refused")

    monkeypatch.setenv("GEMINI_API_KEY", "k")
    monkeypatch.setattr(gemini.requests, "post", fail)

    res = client.post("/api/nano-banana-pro", json=NBP_PAYLOAD)

    assert res.status_code == 500
    assert res.json() == {
        "detail": {
            "message": "Gemini API での画像生成に失敗しました。",
            "raw_response": "ConnectionError: connection refused",
        }
    }


def test_split_panels_requires_image(client) -> None:
    res = client.post("/api/image/split-panels", files={"image": ("x.png", b"")})
    assert res.status_code == 400
    assert res.json() == {"detail": "画像データが提供されていません。"}


def test_split_panels_without_key_is_bad_request(client) -> None:
    res = client.post("/api/image/split-panels", files={"image": ("x.png", make_png(4, 4))})
    assert res.status_code == 400
    assert res.json() == {"detail": gemini.MISSING_API_KEY_MESSAGE}


def test_split_panels_preview(client) -> None:
    res = client.post(
        "/api/image/split-panels/preview", data={"model_name": "gemini-3.8-flash", "thinking_level": "LOW"}
    )
    assert res.json()["request_body"]["generationConfig"]["thinkingConfig"] == {"thinkingLevel": "LOW"}


def test_merge_panels_error_is_bad_request(client) -> None:
    res = client.post("/api/image/merge-panels", data={"target_folder": "missing"})
    assert res.status_code == 400
    assert "panels.json が見つかりません" in res.json()["detail"]


@pytest.mark.parametrize(
    ("route", "target", "kwargs", "message"),
    [
        ("merge-panels", "merge_panels", {"data": {"target_folder": "x"}}, "コマ結合の処理中にエラーが発生しました。"),
        (
            "remove-bg",
            "remove_background",
            {"files": {"image": ("x.png", b"png")}},
            "背景除去の処理中にエラーが発生しました。",
        ),
    ],
)
def test_unexpected_errors_keep_the_original_text(
    client, monkeypatch: pytest.MonkeyPatch, route: str, target: str, kwargs: dict, message: str
) -> None:
    from src.app.routers import image

    def explode(*_a, **_kw):
        raise RuntimeError("disk full")

    monkeypatch.setattr(image, target, explode)
    res = client.post(f"/api/image/{route}", **kwargs)
    assert res.status_code == 500
    assert res.json() == {"detail": {"message": message, "raw_response": "RuntimeError: disk full"}}


def test_remove_bg_requires_image(client) -> None:
    res = client.post("/api/image/remove-bg", files={"image": ("x.png", b"")})
    assert res.status_code == 400
    assert res.json() == {"detail": "画像データが提供されていません。"}
