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

    assert client.post("/api/archives/arc/log", json={"message": "more"}).status_code == 200
    assert (archives_dir / "arc" / "log.txt").read_text(encoding="utf-8") == "line\nmore\n"

    assert client.post("/api/archives/arc/delete_contents", json={"paths": ["sub/a.png"]}).status_code == 200
    assert {e["key"] for e in client.get("/api/archives/arc/contents").json()} == {"arc/log.txt"}
    assert client.post("/api/archives/arc/restore_contents", json={"paths": ["sub/a.png"]}).status_code == 200
    assert "arc/sub/a.png" in {e["key"] for e in client.get("/api/archives/arc/contents").json()}
    assert client.post("/api/archives/arc/restore_contents", json={"paths": ["sub/a.png"]}).status_code == 404
    assert client.delete("/api/archives/arc").status_code == 200
    assert client.get("/api/archives").json() == []
    assert client.post("/api/archives/arc/restore").status_code == 200
    assert [a["key"] for a in client.get("/api/archives").json()] == ["arc"]


def test_archive_errors_use_detail_and_status(client) -> None:
    res = client.get("/api/archives/nope/contents")
    assert res.status_code == 404
    assert res.json() == {"detail": "Archive 'nope' not found"}

    client.post("/api/archives", data={"name": "arc", "paths": ["a.txt"]}, files=[("files", ("a.txt", b"x"))])
    res = client.get("/api/archives/arc/extract", params={"path": "../x"})
    assert res.status_code == 400
    assert res.json() == {"detail": "Path traversal detected"}

    res = client.post("/api/archives", data={"name": "arc", "paths": ["a", "b"]}, files=[("files", ("a", b"x"))])
    assert res.status_code == 400


def test_settings_prompts_roundtrip(client, data_dir: Path) -> None:
    assert client.get("/api/settings/prompts").json() == {}
    assert client.post("/api/settings/prompts", json={"nanoBananaPro_prompt": "着彩して"}).status_code == 200
    assert client.get("/api/settings/prompts").json() == {"nanoBananaPro_prompt": "着彩して"}
    assert (data_dir / "settings" / "default_prompts.json").exists()


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


def test_nano_banana_pro_without_key(client) -> None:
    res = client.post("/api/nano-banana-pro", json=NBP_PAYLOAD)
    assert res.status_code == 500
    assert res.json() == {"detail": "GEMINI_API_KEY is not set."}


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
    ("response", "message"),
    [
        (
            {"promptFeedback": {"blockReason": "PROHIBITED_CONTENT"}},
            "The prompt was blocked (blockReason: PROHIBITED_CONTENT).",
        ),
        (
            {"candidates": [{"content": {"parts": [{"text": "no"}]}, "finishReason": "IMAGE_SAFETY"}]},
            "No image data found in response (finishReason: IMAGE_SAFETY).",
        ),
    ],
)
def test_generate_content_without_image_carries_raw_response(
    client, monkeypatch: pytest.MonkeyPatch, response: dict, message: str
) -> None:
    monkeypatch.setenv("GEMINI_API_KEY", "k")
    monkeypatch.setattr(gemini.requests, "post", lambda *a, **kw: FakeResponse(200, response))

    res = client.post(
        "/api/nano-banana-pro/generate-content",
        json={"model": "gemini-3-pro-image", "contents": [{"parts": [{"text": "hi"}]}]},
    )

    assert res.status_code == 500
    assert res.json() == {
        "detail": {"message": f"Gemini API multimodal generation failed: {message}", "raw_response": response}
    }


def test_nano_banana_pro_api_error_carries_raw_response(client, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GEMINI_API_KEY", "k")
    monkeypatch.setattr(gemini.requests, "post", lambda *a, **kw: FakeResponse(400, {"error": {"message": "blocked"}}))

    res = client.post("/api/nano-banana-pro", json=NBP_PAYLOAD)

    assert res.status_code == 500
    assert res.json() == {
        "detail": {
            "message": "Gemini API multimodal generation failed: API Error (400): blocked",
            "raw_response": {"error": {"message": "blocked"}},
        }
    }


def test_split_panels_requires_image(client) -> None:
    res = client.post("/api/image/split-panels", files={"image": ("x.png", b"")})
    assert res.status_code == 400
    assert res.json() == {"detail": "画像データが提供されていません"}


def test_split_panels_without_key_is_bad_request(client) -> None:
    res = client.post("/api/image/split-panels", files={"image": ("x.png", make_png(4, 4))})
    assert res.status_code == 400
    assert "GEMINI_API_KEY" in res.json()["detail"]


def test_split_panels_preview(client) -> None:
    res = client.post(
        "/api/image/split-panels/preview", data={"model_name": "gemini-3.8-flash", "thinking_level": "LOW"}
    )
    assert res.json()["request_body"]["generationConfig"]["thinkingConfig"] == {"thinkingLevel": "LOW"}


def test_merge_panels_error_is_bad_request(client) -> None:
    res = client.post("/api/image/merge-panels", data={"target_folder": "missing"})
    assert res.status_code == 400
    assert "panels.json が見つかりません" in res.json()["detail"]


def test_unexpected_errors_keep_the_tool_prefix(client, monkeypatch: pytest.MonkeyPatch) -> None:
    from src.app.routers import image

    def explode(*_a, **_kw):
        raise RuntimeError("disk full")

    monkeypatch.setattr(image, "merge_panels", explode)
    res = client.post("/api/image/merge-panels", data={"target_folder": "x"})
    assert res.status_code == 500
    assert res.json() == {"detail": "コマ結合処理中にエラーが発生しました: disk full"}


def test_remove_bg_requires_image(client) -> None:
    res = client.post("/api/image/remove-bg", files={"image": ("x.png", b"")})
    assert res.status_code == 400
