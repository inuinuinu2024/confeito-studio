"""Explains a Gemini response that has no image (blocked prompt, filtered output, text-only answer).

Gemini only says *why* through codes (``promptFeedback.blockReason``, ``candidates[].finishReason``),
an English ``finishMessage`` and sometimes ``safetyRatings``. This module turns them into a Japanese
message with what to do next, and puts the original fields at the top of ``raw_response`` so they
are readable without digging through the JSON (docs/specs/tools/gemini-image.md 「生成されなかった時」).

The fields are searched anywhere in the response (camelCase or snake_case), so the Interactions API,
whose response shape differs from generateContent, is covered too.
"""

import json
from collections.abc import Iterator
from typing import Any

# (what happened, what to do)
FINISH_REASONS: dict[str, tuple[str, str]] = {
    "STOP": (
        "モデルが画像を作らずに文章だけで応答しました。",
        "プロンプトで画像を生成するようにはっきり指示してください。",
    ),
    "MAX_TOKENS": ("出力の上限に達して途中で止まりました。", "再度お試しください。"),
    "SAFETY": (
        "安全フィルタによりブロックされました。",
        "generateContent API の安全設定を緩めると通ることがあります。通らなければプロンプトや参照画像を変えてください。",
    ),
    "RECITATION": ("既存の文章に似すぎているため止められました。", "プロンプトを変えてください。"),
    "LANGUAGE": ("対応していない言語のため止められました。", "日本語か英語で指示してください。"),
    "OTHER": ("理由は示されていません。", "再度お試しください。"),
    "BLOCKLIST": ("禁止されている語句が含まれていました。", "プロンプトを変えてください。"),
    "PROHIBITED_CONTENT": (
        "Google の利用ポリシーで禁止されている内容と判定されました。",
        "安全設定では解除できません。プロンプトや参照画像を変えてください。",
    ),
    "SPII": ("個人を特定できる機微な情報が含まれると判定されました。", "プロンプトや参照画像を変えてください。"),
    "MALFORMED_FUNCTION_CALL": ("ツール呼び出しに失敗しました。", "Google 検索をオフにして再度お試しください。"),
    "UNEXPECTED_TOOL_CALL": ("想定外のツール呼び出しで止まりました。", "Google 検索をオフにして再度お試しください。"),
    "TOO_MANY_TOOL_CALLS": ("ツール呼び出しが多すぎて止まりました。", "Google 検索をオフにして再度お試しください。"),
    "IMAGE_SAFETY": (
        "生成された画像が安全フィルタによりブロックされました。",
        "generateContent API の安全設定を緩めると通ることがあります。通らなければプロンプトや参照画像を変えてください。",
    ),
    "IMAGE_PROHIBITED_CONTENT": (
        "生成された画像が Google の利用ポリシーで禁止されている内容と判定され、除外されました。",
        "安全設定では解除できません。プロンプトや参照画像を変えてください。",
    ),
    "IMAGE_RECITATION": (
        "生成された画像が既存の作品（著作物など）に似すぎているため除外されました。",
        "プロンプトや参照画像を変えてください。",
    ),
    "IMAGE_OTHER": ("画像の生成が別の理由で止まりました。", "再度お試しください。"),
    "NO_IMAGE": ("画像を生成できませんでした。", "プロンプトを具体的にして再度お試しください。"),
}

BLOCK_REASONS: dict[str, tuple[str, str]] = {
    "SAFETY": (
        "入力が安全フィルタによりブロックされました。",
        "generateContent API の安全設定を緩めると通ることがあります。通らなければプロンプトや参照画像を変えてください。",
    ),
    "OTHER": ("入力がブロックされました（理由は示されていません）。", "プロンプトや参照画像を変えてください。"),
    "BLOCKLIST": ("入力に禁止されている語句が含まれていました。", "プロンプトを変えてください。"),
    "PROHIBITED_CONTENT": (
        "入力が Google の利用ポリシーで禁止されている内容と判定されました。",
        "安全設定では解除できません。プロンプトや参照画像を変えてください。",
    ),
    "IMAGE_SAFETY": (
        "入力した画像が安全フィルタによりブロックされました。",
        "参照画像や原画を変えてください。",
    ),
}

HARM_CATEGORIES: dict[str, str] = {
    "HARM_CATEGORY_HARASSMENT": "ハラスメント",
    "HARM_CATEGORY_HATE_SPEECH": "ヘイトスピーチ",
    "HARM_CATEGORY_SEXUALLY_EXPLICIT": "性的表現",
    "HARM_CATEGORY_DANGEROUS_CONTENT": "危険なコンテンツ",
    "HARM_CATEGORY_CIVIC_INTEGRITY": "市民の誠実性",
    "HARM_CATEGORY_JAILBREAK": "ジェイルブレイク",
}

# Ratings at these levels are named in the message (with "blocked": true they always are).
NOTABLE_PROBABILITIES = {"MEDIUM", "HIGH"}


def _values(data: Any, *keys: str) -> Iterator[Any]:
    """Every value stored under one of ``keys`` anywhere in ``data`` (depth first, in order)."""
    if isinstance(data, dict):
        for key, value in data.items():
            if key in keys:
                yield value
            yield from _values(value, *keys)
    elif isinstance(data, list):
        for item in data:
            yield from _values(item, *keys)


def _unique_strings(values: Iterator[Any]) -> list[str]:
    result: list[str] = []
    for value in values:
        if isinstance(value, str) and value and value not in result:
            result.append(value)
    return result


def _texts(data: Any) -> list[str]:
    """Text the model answered with (thought summaries excluded)."""
    texts: list[str] = []
    for parts in _values(data, "parts", "content"):
        for part in parts if isinstance(parts, list) else []:
            if isinstance(part, dict) and not part.get("thought") and part.get("type", "text") == "text":
                text = part.get("text")
                if isinstance(text, str) and text.strip() and text.strip() not in texts:
                    texts.append(text.strip())
    return texts


def _notable_ratings(data: Any) -> list[dict[str, Any]]:
    ratings: list[dict[str, Any]] = []
    for value in _values(data, "safetyRatings", "safety_ratings"):
        for rating in value if isinstance(value, list) else []:
            if not isinstance(rating, dict):
                continue
            if rating.get("blocked") or rating.get("probability") in NOTABLE_PROBABILITIES:
                ratings.append(rating)
    return ratings


def _rating_label(rating: dict[str, Any]) -> str:
    category = str(rating.get("category", ""))
    name = HARM_CATEGORIES.get(category, category.removeprefix("HARM_CATEGORY_"))
    blocked = "・ブロック" if rating.get("blocked") else ""
    return f"{name}（{rating.get('probability', '?')}{blocked}）"


def _explain(codes: list[str], table: dict[str, tuple[str, str]]) -> str:
    known = [table[code] for code in codes if code in table]
    if not known:
        return ""
    what = "".join(dict.fromkeys(w for w, _ in known))
    todo = "".join(dict.fromkeys(t for _, t in known))
    return what + todo


def describe_no_image(data: Any, *, status: str | None = None) -> tuple[str, str]:
    """(Japanese message, raw_response text) for a response without an image.

    ``status``: the Interactions API's status when it is not "completed".
    """
    block_reasons = _unique_strings(_values(data, "blockReason", "block_reason"))
    finish_reasons = _unique_strings(_values(data, "finishReason", "finish_reason"))
    finish_messages = _unique_strings(
        _values(data, "finishMessage", "finish_message", "blockReasonMessage", "block_reason_message")
    )
    ratings = _notable_ratings(data)
    texts = _texts(data)

    if block_reasons:
        message = f"入力がブロックされたため、画像は生成されませんでした（blockReason: {', '.join(block_reasons)}）。"
        message += _explain(block_reasons, BLOCK_REASONS)
    elif finish_reasons and finish_reasons != ["STOP"]:
        message = f"画像が生成されませんでした（finishReason: {', '.join(finish_reasons)}）。"
        message += _explain(finish_reasons, FINISH_REASONS)
    elif status:
        message = f"画像の生成が完了しませんでした（status: {status}）。"
    elif texts:
        message = "Gemini の応答に画像が含まれていませんでした。" + "".join(FINISH_REASONS["STOP"])
    else:
        message = "Gemini の応答に画像が含まれていませんでした。"
    if ratings:
        message += f"判定されたカテゴリ: {'、'.join(_rating_label(r) for r in ratings)}。"

    summary = [
        *(f"blockReason: {r}" for r in block_reasons),
        *(f"finishReason: {r}" for r in finish_reasons),
        *(f"finishMessage: {m}" for m in finish_messages),
        *(f"status: {status}" for _ in [status] if status),
        *(f"text: {t}" for t in texts),
    ]
    body = json.dumps(data, ensure_ascii=False, indent=2) if not isinstance(data, str) else data
    raw = "\n".join(summary) + "\n\n" + body if summary else body
    return message, raw
