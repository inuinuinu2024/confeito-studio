---
aliases: []
tags:
  - Confeito-Studio
  - ツール製作
  - 画像生成
  - Nano-Banana
status: living
created: 2026-08-11
updated: 2026-08-11
---

# Nano Banana Pro ツール方針


## 位置づけ
- モデルID: `gemini-3-pro-image`
- 着彩機能に限定しない**汎用画像生成/編集ツール**として実装する
- 品質・複雑な指示への忠実性を優先する用途担当（速度・コスト優先は[[Nano Banana 2 ツール方針|Nano Banana 2]]側）

## 想定ユースケース
- 複雑な構図・指示を正確に反映させたい生成/編集
- キャラクターやブランドロゴなど、複数カットで見た目を一致させたい場合
- 画風・スタイルを参照画像から反映させたい場合
- 線画着彩など、既存機能からの呼び出し先の一つ

## モジュール構成
```
tools/
  nano_banana_pro.py      # 本ツール。generate()を公開
  _gemini_image_core.py   # Nano Banana 2と共有する低レベルAPI呼び出し処理
```
- API呼び出しの共通処理（base64化、`interaction.output_image`の取り出し等）は`_gemini_image_core.py`に集約し、本ツールはモデル固有のパラメータ定義と`generate()`関数のみを持つ
- 着彩機能などの利用側は`features/`層からこのツールを呼び出す（前処理・後処理はfeatures側の責務）

## 設定する主な引数
- `input`: テキスト + 参照画像（画像は合計最大14枚。内訳: 高精度反映オブジェクト最大6枚、キャラクター一貫性最大5枚、スタイル参照最大3枚）。動画入力は非対応
- `response_format.aspect_ratio`: `1:1, 2:3, 3:2, 3:4, 4:3, 4:5, 5:4, 9:16, 16:9, 21:9`（標準10種のみ、極端な比率は非対応）
- `response_format.image_size`: `1K` / `2K` / `4K`（0.5Kは非対応）
- `response_format.mime_type`: `image/png` / `image/jpeg`
- `tools`: `google_search`によるWeb検索グラウンディングのみ対応（画像検索連携は非対応）
- `previous_interaction_id`: マルチターン編集に使用
- `generation_config`: 使用しない（Thinkingは常時有効・調整不可のため）

## 注意点
- Thinkingプロセスが常時走るため、[[Nano Banana 2 ツール方針|Nano Banana 2]]よりレイテンシ・コストが高くなる
- Function calling / Structured outputs / Code execution / File search / Caching / Audio生成 / Live API / URL context / Maps groundingは非対応
- 生成画像には無効化不可のSynthID電子透かしが付与される


