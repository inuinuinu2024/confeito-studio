"""Japanese explanations of Gemini responses without an image (fake responses only, no API calls)."""

import json

from src.app.providers.gemini_reasons import describe_no_image

FINISH_MESSAGE = (
    "Unable to show the generated image. The image was filtered out because it violated Google's "
    "Generative AI Prohibited Use policy."
)


def test_prohibited_content_explains_that_safety_settings_do_not_help() -> None:
    # The response reported by the user (generateContent, gemini-3-pro-image).
    data = {
        "candidates": [
            {"content": {}, "finishReason": "PROHIBITED_CONTENT", "index": 0, "finishMessage": FINISH_MESSAGE}
        ],
        "usageMetadata": {"promptTokenCount": 341, "totalTokenCount": 498, "thoughtsTokenCount": 157},
    }

    message, raw = describe_no_image(data)

    assert message == (
        "画像が生成されませんでした（finishReason: PROHIBITED_CONTENT）。"
        "Google の利用ポリシーで禁止されている内容と判定されました。"
        "安全設定では解除できません。プロンプトや参照画像を変えてください。"
    )
    # The reason fields come first, then Gemini's whole response.
    assert raw == (
        f"finishReason: PROHIBITED_CONTENT\nfinishMessage: {FINISH_MESSAGE}\n\n"
        + json.dumps(data, ensure_ascii=False, indent=2)
    )


def test_names_the_harm_categories_that_were_flagged() -> None:
    data = {
        "candidates": [
            {
                "finishReason": "SAFETY",
                "safetyRatings": [
                    {"category": "HARM_CATEGORY_SEXUALLY_EXPLICIT", "probability": "HIGH", "blocked": True},
                    {"category": "HARM_CATEGORY_HARASSMENT", "probability": "NEGLIGIBLE"},
                    {"category": "HARM_CATEGORY_DANGEROUS_CONTENT", "probability": "MEDIUM"},
                ],
            }
        ]
    }

    message, _ = describe_no_image(data)

    assert message.startswith(
        "画像が生成されませんでした（finishReason: SAFETY）。安全フィルタによりブロックされました。"
    )
    assert message.endswith("判定されたカテゴリ: 性的表現（HIGH・ブロック）、危険なコンテンツ（MEDIUM）。")


def test_text_only_answer_quotes_the_text_and_skips_thoughts() -> None:
    data = {
        "candidates": [
            {
                "content": {
                    "parts": [
                        {"text": "thinking...", "thought": True},
                        {"text": "I can't draw that, but here is a description."},
                    ]
                },
                "finishReason": "STOP",
            }
        ]
    }

    message, raw = describe_no_image(data)

    assert message == (
        "Gemini の応答に画像が含まれていませんでした。"
        "モデルが画像を作らずに文章だけで応答しました。プロンプトで画像を生成するようにはっきり指示してください。"
    )
    assert raw.startswith("finishReason: STOP\ntext: I can't draw that, but here is a description.\n\n")
    assert "text: thinking..." not in raw


def test_interactions_api_fields_are_found_in_snake_case() -> None:
    data = {
        "status": "failed",
        "steps": [
            {"content": [{"type": "thought", "text": "hmm"}], "finish_reason": "IMAGE_RECITATION"},
        ],
    }

    message, raw = describe_no_image(data, status="failed")

    assert message.startswith("画像が生成されませんでした（finishReason: IMAGE_RECITATION）。")
    assert "既存の作品（著作物など）に似すぎている" in message
    assert raw.startswith("finishReason: IMAGE_RECITATION\nstatus: failed\n\n")


def test_unfinished_interaction_without_a_reason() -> None:
    message, raw = describe_no_image({"status": "incomplete"}, status="incomplete")

    assert message == "画像の生成が完了しませんでした（status: incomplete）。"
    assert raw.startswith("status: incomplete\n\n")


def test_unknown_codes_are_shown_without_an_explanation() -> None:
    message, _ = describe_no_image({"candidates": [{"finishReason": "SOMETHING_NEW"}]})

    assert message == "画像が生成されませんでした（finishReason: SOMETHING_NEW）。"


def test_nothing_to_go_on() -> None:
    message, raw = describe_no_image({"candidates": []})

    assert message == "Gemini の応答に画像が含まれていませんでした。"
    assert raw == json.dumps({"candidates": []}, indent=2)
