# Nano Banana画像生成（`features/tools/nano-banana-pro/`）

共通の仕組み（参照画像の一覧・プロンプト欄・送信テキスト）は [gemini-image.md](./gemini-image.md)。設定キーは `nanoBananaPro_*`。

- ツール名（TOOLS の一覧・ウィンドウの見出し・トースト・結果フォルダ名）は「Nano Banana画像生成」。
  旧名「Nano Banana Pro」の名残として、フォルダ名 `nano-banana-pro/`・id・設定キー `nanoBananaPro_*`・API のパス `/api/nano-banana-pro` はそのまま
  （設定を引き継ぐため）。モデルの通称「Nano Banana Pro」「Nano Banana」など（下の表）はツール名とは別。

- 参照画像とプロンプトから画像を 1 枚生成する汎用ツール。参照画像はファイル選択かドラッグ＆ドロップで加える。
  キャンバスの画像は、「原画」として設定した時だけ送る（下の「原画」）。
- 送信テキスト: 参照画像を `# Image 1` から順に並べ、（原画があればその見出し、）最後に `# User prompt` とプロンプト（API に関係なく同じ）。
  プロンプトが空なら実行しない（注意トースト）。プロンプトの登録・読み出しは [gemini-image.md](./gemini-image.md)「プロンプト」。

## 画面（ツールウィンドウを横に広げた 3 列。幅 1200px、各列は 400px で別々にスクロール）
| 左 | 中央 | 右 |
|---|---|---|
| モデルと API、プロンプト | 原画、参照画像の一覧（1 枚ごとに種類・★・説明・順番） | そのほかのパラメータ、JSON プレビュー |

- **左: モデルと API**（見出しは「モデルと API」。番号は付けない）: モデルと API を選ぶ（`nanoBananaPro_model` / `nanoBananaPro_api`、
  既定は `gemini-3-pro-image` と Interactions API）。モデルは通称（Nano Banana Pro / Nano Banana 2 / Nano Banana 2 Lite / Nano Banana）で選ぶ。
  選択欄のすぐ下に「正式名: <正式名>（<モデル ID>）」と一行説明を出す（例: 正式名: Gemini 3 Pro Image（gemini-3-pro-image））。
  その下のプロンプト欄は左の列の残りの高さいっぱいに広がる（最低 240px）。
- **中央: 原画と参照画像**: 先頭に「原画」欄（下の「原画」）、その下に参照画像の一覧。参照画像は画像ごとに種類・★・説明・順番を設定する
  （[gemini-image.md](./gemini-image.md)「参照画像」）。使える種類と合計の上限は選んだモデルで決まる（原画があると合計の上限は 1 枚減る）。
- **右: パラメータ**: 選んだ組み合わせで設定できる項目だけを表示する（以前あった「生成設定」の見出しと「<通称>（<正式名>）× <API 名>」の表示はなし）。
  並び: 出力 → 思考・サンプリング → 安全設定 → システム指示・ツール → API オプション → （Thinking の注記）→ JSON プレビュー。
- モデルか API を変えた時、原画を設定・解除した時は中央と右の列を作り直す（プロンプトはそのまま）。
- 画面が狭い（幅 960px 以下）ときは 3 列を縦に並べ、まとめてスクロールする。
- パラメータの項目:
   - 各項目のヘルプ（?）に説明と「送信先: <リクエスト内の項目名>」を出す。
   - 選択式の項目は先頭に「既定（送らない）」がある。選ぶとその項目をリクエストに含めない（Gemini 側の既定値になる）。
     数値・テキストの項目は空欄が「既定（送らない）」。範囲外・整数でない数値は送らない（入力欄を赤枠にする）。
   - 保存済みの値がそのモデル・API で使えない場合は「既定（送らない）」として扱う。値自体は残すので、元のモデル・API に戻すと復活する。
   - 未保存の項目の初期値は「既定（送らない）」。ただし以前から送っていたアスペクト比 `1:1`・画像サイズ `1K`・出力形式 PNG は
     その値を初期値にする（既存の挙動を変えない）。
- モデルを変えた時の参照画像の扱い（ない種類は最初の種類に変える、合計の上限を超える分は外す）は [gemini-image.md](./gemini-image.md)「参照画像」。
- 右の列の一番下の「JSON プレビュー」は実際に送るリクエスト（画像データは `BASE64_IMAGE_DATA`）を表示する。タイトルに API 名と送信先を出す。

## 原画（`original.ts` が計算、`original-image.ts` が画面と画像処理）
原画を設定すると、出力はその原画を書き直した画像になり、**原画と同じ大きさで保存する**（ラフ → 清書、線画 → 着彩など）。

- **設定**: 中央の列の先頭の「原画」欄。クリック／ドラッグ＆ドロップで画像を 1 枚選ぶか、「表示中の画像を原画にする」でキャンバスに表示中の画像を使う
  （キャンバスに画像がない時は注意トースト）。設定するとサムネイル・名前・`W x H px`・送り方（例「アスペクト比 3:4 に合わせて左右に白い余白を足して送る」）を出し、× で解除する。
  原画は参照画像と同じくツールの中に保持する（ウィンドウを閉じても残る、再読み込みで消える。ブラウザには保存しない）。
- **アスペクト比は自動**: モデルが対応する比のうち、原画の縦横比に最も近いもの（`|ln(原画の比) − ln(出力の比)|` が最小）。
  出力の比は名目値（2:3 など）ではなく実際の出力ピクセル（下の表の値。例 Pro の 2:3 = 848 x 1264）で比べる。
  右の列のアスペクト比のボタンはすべて押せなくなり、自動で選んだ比が選択状態になる。下の文言は
  「原画に合わせて自動: 3:4 / 生成: 896 x 1200 px → 保存: 300 x 420 px（原画と同じ）」。保存済みのアスペクト比の値は書き換えない（原画を外すと戻る）。
  画像サイズは今まで通り選べる（未指定は API の既定 1K として計算する）。
- **送る画像**: 予定の出力サイズと同じ縦横比の白いキャンバスの中央に、原画を縦横比を保って収める（足りない側が白い余白になる。歪ませない）。
  大きさは予定の出力サイズ、ただし長辺 2048px まで（参照画像と同じ上限。[gemini-image.md](./gemini-image.md)「送る時の縮小」）。透過部分は白で塗る。PNG で送る。
- **送る順番と文章**: 原画は参照画像の後ろ（N + 1 枚目）に送り、見出しも番号を続ける（参照画像カードの Image 1..N と番号がずれない）:
  ```text
  # Image N+1（原画）
  この画像を原画とする。出力はこの原画を書き直した画像にすること。構図・輪郭・各要素の位置と大きさは原画と一致させること。
  画像の上下（左右）にある白い余白は縦横比を合わせるための詰め物なので、何も描かず白のままにすること。   ← 余白がある時だけ
  (空行)
  ```
- **戻し方**: 送った画像の中で原画が占める範囲を 0〜1 の比率で覚えておき、返ってきた画像（実際の大きさ）からその範囲を切り出して、
  原画と同じ W x H に高品質補間で拡大縮小する。予定と違う大きさで返ってきても範囲は合う。形式は返ってきた画像と同じ（PNG / JPEG）。
- **保存**: 戻した画像を結果の画像（`<YYYYMMDD_HHMMSS>_Nano Banana画像生成.*`）にし、返ってきたままの画像を `Raw/generated.*` に保存する。
  ファイルから設定した原画は `Inputs/Original.*` にコピーし `source` は null。キャンバスから設定した原画はコピーせず、その ARCHIVES キーを `source` にする。
  `info.json` の settings に `original`（`width` / `height` / `aspectRatio` / `padding`（`none` / `vertical` / `horizontal`）/ `sentSize` / `generatedSize`）を加える。

## モデルごとの対応（`models.ts`。出典: Gemini API ガイド「Nano Banana image generation」）

| 通称（正式名 / モデル ID） | アスペクト比 | 画像サイズ | 思考レベル | Google 検索 | 参照画像の種類（推奨枚数）と合計の上限 |
|---|---|---|---|---|---|
| Nano Banana Pro（Gemini 3 Pro Image / `gemini-3-pro-image`） | 10 種 | 1K / 2K / 4K | 変更不可（常に有効） | ウェブ | Object 6 / Character 5 / Style 3（合計 14） |
| Nano Banana 2（Gemini 3.1 Flash Image / `gemini-3.1-flash-image`） | 14 種（+ 1:4, 4:1, 1:8, 8:1） | 512 / 1K / 2K / 4K | minimal / high | ウェブ、ウェブ + 画像 | Object 10 / Character 4（合計 14） |
| Nano Banana 2 Lite（Gemini 3.1 Flash Lite Image / `gemini-3.1-flash-lite-image`） | 10 種 | 1K のみ | minimal / high | なし | Object 14（合計 14） |
| Nano Banana（Gemini 2.5 Flash Image / `gemini-2.5-flash-image`） | 10 種 | なし（約 1024px 固定） | なし | なし | Object 3（合計 3） |

- 10 種 = `1:1, 2:3, 3:2, 3:4, 4:3, 4:5, 5:4, 9:16, 16:9, 21:9`。
- 「思考の要約」は Gemini 3 のモデル（思考するモデル）だけに出す。
- 出力サイズの表示（画像サイズの選択肢・アスペクト比の下の「出力: W x H px」）はガイドの表の値。
  Gemini 3 は 1K の値を基準に 512 = 0.5 倍、2K = 2 倍、4K = 4 倍。gemini-2.5-flash-image は固定の表。
- `nano-banana-pro-preview`（別名）は一覧に出さない。

## API ごとの項目（`options.ts` / `request.ts`）

| 項目 | Interactions API | generateContent API |
|---|---|---|
| アスペクト比 | `response_format.aspect_ratio` | `generationConfig.imageConfig.aspectRatio` |
| 画像サイズ | `response_format.image_size` | `generationConfig.imageConfig.imageSize` |
| 出力形式 | `response_format.mime_type`: `image/png` / `image/jpeg` | `generationConfig.responseFormat.image.mimeType`: `IMAGE_JPEG` のみ |
| 応答の種類 | なし（`response_format.type: "image"` を常に送る） | `generationConfig.responseModalities`: `["IMAGE"]` / `["TEXT", "IMAGE"]` |
| 思考レベル | `generation_config.thinking_level`: `minimal` / `high` | `generationConfig.thinkingConfig.thinkingLevel`: `MINIMAL` / `HIGH` |
| 思考の要約 | `generation_config.thinking_summaries`: `auto` / `none` | `generationConfig.thinkingConfig.includeThoughts`: `true` / `false` |
| temperature（0〜2）, topP（0〜1）, topK（1 以上の整数） | なし | `generationConfig.temperature` / `topP` / `topK` |
| seed（0〜2147483647 の整数） | `generation_config.seed` | `generationConfig.seed` |
| 安全設定 | なし（送ると 400。[gemini-image.md](./gemini-image.md)） | `safetySettings[]`（下記） |
| システム指示 | `system_instruction`（文字列） | `systemInstruction.parts[].text` |
| Google 検索 | `tools: [{"type": "google_search"}]`、画像検索込みは `search_types: ["web_search", "image_search"]` | `tools: [{"googleSearch": {}}]`、画像検索込みは `searchTypes: {webSearch: {}, imageSearch: {}}` |
| store | `store`: `true` / `false`（保存。API の既定は true） | `store`: `true` / `false`（ログ記録） |
| service tier | `service_tier`: `standard` / `flex` / `priority` | `serviceTier`: `standard` / `flex` / `priority` |

- 安全設定: カテゴリ `HARASSMENT` / `HATE_SPEECH` / `SEXUALLY_EXPLICIT` / `DANGEROUS_CONTENT` / `JAILBREAK`（`HARM_CATEGORY_` 付きで送る）ごとに
  `BLOCK_LOW_AND_ABOVE` / `BLOCK_MEDIUM_AND_ABOVE` / `BLOCK_ONLY_HIGH` / `BLOCK_NONE` / `OFF` を選ぶ。見出しの「すべて OFF」「すべて既定」で一括変更。
  「既定」以外を選んだカテゴリだけを送る。非推奨の `HARM_CATEGORY_CIVIC_INTEGRITY` は出さない。
- 出さない項目（画像生成に効かない、または使えないもの）: 音声・動画・関数呼び出し・キャッシュ・ストリーミング・会話の継続・
  `background`・`max_output_tokens`/`maxOutputTokens`・`stop_sequences`・`candidateCount`・penalty 類・logprobs・`mediaResolution`/入力画像の `resolution`
  （`gemini-3-pro-image` では 400）・`delivery`・`service_tier: "deferred"`・`enterprise_web_search`・`labels`。
- generateContent の `model` はリクエスト本文の `model` として送り、バックエンドが URL（`models/{model}:generateContent`）に移す。
- 実 API で確認済み（2026-10-02、`gemini-3-pro-image`・1:1・1K・JPEG）: Interactions の `response_format.mime_type: "image/jpeg"`、
  generateContent の `imageConfig` と `responseFormat.image.mimeType: "IMAGE_JPEG"` の同時指定は、どちらも 1024x1024 の JPEG を返す。
- 送信先: Interactions は `POST /api/nano-banana-pro`、generateContent は `POST /api/nano-banana-pro/generate-content`。

## 保存
- 保存先は共通ルール（[archives.md](../archives.md)「ツールの結果の保存」）: 選択中アーカイブの中の `YYYYMMDD_HHMMSS_Nano Banana画像生成/`、
  未選択なら新しいアーカイブ。`YYYYMMDD_HHMMSS_Nano Banana画像生成.png|.jpg`、`Inputs/Image1.*`, `Inputs/Image2.*`, ...、
  `Inputs/payload.json`（実際に送ったリクエスト。画像データは省略）、`info.json`（source = null、settings = `model` / `api`）を保存する。
  原画がある時は `Raw/generated.*`・`Inputs/Original.*`・`settings.original` が加わる（上の「原画」）。
- 画像の拡張子は、実際に返ってきた画像の形式（バックエンドの応答の Content-Type）で決める。
- 完了後: 「Nano Banana画像生成: 「<結果フォルダ>」に画像を保存しました」のトースト。生成画像を自動選択・表示する。
- エラー時: バックエンドの日本語メッセージをエラートーストに出し、Gemini の生の応答（セーフティブロック等）を原文として併せて表示する
  （[notifications.md](../notifications.md)）。error.txt は書かない。
