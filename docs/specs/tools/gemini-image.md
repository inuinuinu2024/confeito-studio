# Gemini 画像生成ツールの共通部品（`features/tools/gemini-image/`）

参照画像のドロップゾーン、プロンプト欄、送信テキストの組み立て。現在の利用者は Nano Banana Pro だけ
（モデル・API ごとの項目とリクエストの形は [nano-banana-pro.md](./nano-banana-pro.md)）。

## 参照画像（ドロップゾーン）
- ゾーン: 高精度反映オブジェクト (Object) / キャラクター一貫性 (Character) / スタイル参照 (Style)。どのゾーンを出すか・上限枚数はモデルで決まる。
- 追加方法: クリックでファイル選択（複数可）、ドラッグ＆ドロップ、「キャンバス追加」（表示中の画像を PNG として追加）。
- サムネイルの番号は全ゾーン通しの順番で、プロンプトの `# Image N` と対応する。★ で「重要画像」に設定、× で削除。
- 追加した画像はサイドバーを閉じても保持される（アプリを再読み込みすると消える）。
- 各ゾーンのヘルプ（?）に用途の例を表示する。

## プロンプト
- テキストエリアの内容は `<prefix>_prompt` に即時保存。鉛筆アイコンで `<prefix>_defaultPrompt` を編集できる。
  デフォルトを保存した時、テキストエリアが保存済みのプロンプトと同じなら新しいデフォルトで置き換える。
- 送信するテキストは、画像ごとの見出しとユーザープロンプトを連結したもの:
  ```text
  # Image N
  この画像を<ゾーン名>画像とする。
  これはユーザにより重要画像に設定されている。   ← ★ の画像のみ
  (空行)
  ...
  # User prompt
  <プロンプト>
  ```

## Gemini API の制約（確認済み）
- Interactions API は safety settings を受け付けない。API リファレンスには最上位の `safety_settings` が載っているが、
  実際に送ると 400 `invalid_request`（"The parameter 'safety_settings' is not available on the Gemini API but it is available on
  the Gemini Enterprise Agent Platform."）になる。安全設定は generateContent API の `safetySettings` で指定する。

## エラー
- API キー未設定のエラーは「Gemini API Key が設定されていません。右上の設定アイコンから設定してください。」に置き換えて表示する。
- Gemini のエラー本文（セーフティブロック等）は `raw_response` としてバックエンドから届き、エラー記録に残す。
  事前ブロック（400）では `safetyRatings` 等が含まれないことがある。生成後のブロック（200 で `finishReason: SAFETY` 等）では含まれる。
