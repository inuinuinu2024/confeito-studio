# Gemini 画像生成ツールの共通部品（`features/tools/gemini-image/`）

参照画像の一覧、プロンプト欄、送信テキストの組み立て。現在の利用者は Nano Banana画像生成 ツールだけ
（モデル・API ごとの項目とリクエストの形は [nano-banana-pro.md](./nano-banana-pro.md)）。

## 参照画像（1 つの一覧。`reference-images.ts`、純粋な処理は `reference-list.ts`）
- **上限があるのは合計の枚数だけ**。合計の上限はモデルの種類ごとの推奨枚数の和（例: Nano Banana Pro は 6 + 5 + 3 = 14 枚）。
  種類ごとの枚数は Gemini の推奨枚数の目安で、超えても追加・変更・送信できる。
  Nano Banana画像生成 で原画を設定している間は、原画も 1 枚として送るので合計の上限が 1 枚減る（例 14 → 13。超えた分は後ろから外し、注意トーストで知らせる）。
- 見出し「参照画像」（ヘルプ（?）に種類ごとの用途の例・上限の考え方・説明の送られ方）、その下に枚数
  （例: `合計 4/14　Object 0/6　Character 0/5　Style 4/3`）。合計が上限に達した時、種類が推奨枚数を超えた時は黄色で表示する。
- 追加口は 1 つ: クリックでファイル選択（複数可）、またはドラッグ＆ドロップ。キャンバスに表示中の画像を追加するボタンはない。
  新しい画像の種類は、推奨枚数に余裕のある最初の種類（Object → Character → Style の順）。どれも推奨枚数に達していれば最初の種類。
  合計が上限なら追加口は「上限まで追加しました」になり、超えた分は追加せず注意トーストで枚数を知らせる。
- モデルを変えた時: そのモデルにない種類の画像はそのモデルの最初の種類に変え（トーストで枚数を知らせる）、
  合計の上限を超える分は後ろから外す（注意トーストで枚数を知らせる）。
- 画像は 1 枚ずつカードで並ぶ（上から Image 1, 2, …。プロンプトの `# Image N` と同じ番号）。カードで個別に設定できること:
  - **種類**: 高精度反映オブジェクト (Object) / キャラクター一貫性 (Character) / スタイル参照 (Style) のうち、そのモデルにあるもの。
    推奨枚数を超えていても選べる。
  - **★**: 「重要画像」に設定する。
  - **説明**: 自由入力のテキスト（任意）。送る文章でその画像の見出しの下に入る。
  - **並べ替え**: 左上のつまみ（⋮⋮）をドラッグして順番を変える（番号が付け直される）。
  - **×**: 削除。
- 追加した画像と設定はツールウィンドウを閉じても保持される（アプリを再読み込みすると消える。ブラウザには保存しない）。
- **送る時の縮小**（`payload.ts` の `uploadImage`）: 長辺が 2048px（`constants.ts` の `MAX_UPLOAD_SIDE`）を超える画像は、縦横比を保って長辺 2048px に縮小して送る
  （Gemini のリクエスト上限 約 20MB を超えないため）。拡大はしない。JPEG / WebP は同じ形式、それ以外は PNG で送る。読み込めない画像はそのまま送る。
  JSON プレビューも縮小後の画像。結果フォルダの `Inputs/` には追加した時のままのファイルを保存する。

## プロンプト
- テキストエリアの内容は `<prefix>_prompt` に即時保存。鉛筆アイコンで `<prefix>_defaultPrompt` を編集できる。
  デフォルトを保存した時、テキストエリアが保存済みのプロンプトと同じなら新しいデフォルトで置き換える。
- 送信するテキストは、画像ごとの見出しとユーザープロンプトを連結したもの:
  ```text
  # Image N
  この画像を<種類名>画像とする。
  これはユーザにより重要画像に設定されている。   ← ★ の画像のみ
  <説明>                                        ← 説明を入力した画像のみ（前後の空白は除く）
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
- API キー未設定のエラーは、バックエンドが「Gemini API Key が設定されていません。右上の設定アイコンから設定してください。」を HTTP 400 で返す（コマ分割も同じ文・同じステータス。サーバーの故障ではないので 500 にしない）。
- Gemini のエラー本文（セーフティブロック等）は `raw_response` としてバックエンドから届き、エラートーストの原文に表示する（[notifications.md](../notifications.md)）。
  事前ブロック（400）では `safetyRatings` 等が含まれないことがある。生成後のブロック（200 で `finishReason: SAFETY` 等）では含まれる。

### 画像が生成されなかった時（`backend/src/app/providers/gemini_reasons.py`）
Gemini が応答したのに画像がない場合（入力のブロック、生成画像の除外、文章だけの応答）。
- **HTTP 422** で返す（サーバーの故障ではないので 500 にしない）。両方の API で同じ。
- **メッセージ**: 理由のコードと、日本語の説明・対処。
  - 入力のブロック（`blockReason`）: 「入力がブロックされたため、画像は生成されませんでした（blockReason: X）。<説明><対処>」
  - 生成されなかった（`finishReason`）: 「画像が生成されませんでした（finishReason: X）。<説明><対処>」
  - 文章だけの応答（`STOP`）: 「Gemini の応答に画像が含まれていませんでした。モデルが画像を作らずに文章だけで応答しました。…」
  - Interactions API の `status` が `completed` 以外で理由がない: 「画像の生成が完了しませんでした（status: X）。」
  - `safetyRatings` に `blocked: true` か確率 `MEDIUM` / `HIGH` があれば「判定されたカテゴリ: 性的表現（HIGH・ブロック）、…。」を足す。
  - 表にないコードはコードだけを出す（説明なし）。
- **原文**: 先頭に `blockReason` / `finishReason` / `finishMessage`（Gemini の英文の説明）/ `status` / `text`（モデルが返した文章。思考の要約は除く）を
  1 行ずつ並べ、空行の後に Gemini の応答全体（JSON）。項目は応答のどこにあっても拾う（camelCase / snake_case のどちらも）。
- 主なコードの説明:

  | コード | 説明 | 対処 |
  |---|---|---|
  | `PROHIBITED_CONTENT` / `IMAGE_PROHIBITED_CONTENT` | Google の利用ポリシーで禁止されている内容と判定 | 安全設定では解除できない。プロンプトや参照画像を変える |
  | `SAFETY` / `IMAGE_SAFETY` | 安全フィルタによるブロック | generateContent API の安全設定を緩めると通ることがある |
  | `RECITATION` / `IMAGE_RECITATION` | 既存の文章・作品（著作物など）に似すぎ | プロンプトや参照画像を変える |
  | `BLOCKLIST` / `SPII` | 禁止語句 / 個人を特定できる機微な情報 | プロンプトや参照画像を変える |
  | `NO_IMAGE` / `IMAGE_OTHER` / `OTHER` / `MAX_TOKENS` | 画像を作れなかった・別の理由・出力上限 | 再試行、プロンプトを具体的にする |
  | `MALFORMED_FUNCTION_CALL` / `UNEXPECTED_TOOL_CALL` / `TOO_MANY_TOOL_CALLS` | ツール呼び出しの失敗 | Google 検索をオフにする |
  | `blockReason: IMAGE_SAFETY` | 入力した画像のブロック | 参照画像や原画を変える |

- `PROHIBITED_CONTENT` 系では Gemini はカテゴリも原因の入力も返さない（`safetyRatings` なし）。どの入力が原因かは、参照画像を 1 枚ずつ外す・
  プロンプトを変えるなどして確かめるしかない。
