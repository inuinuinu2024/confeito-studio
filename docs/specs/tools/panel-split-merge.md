# コマ分割 / コマ結合

## コマ分割（`features/tools/panel-splitter.ts` → `POST /api/image/split-panels`）
漫画ページから Gemini でコマ枠を検出し、コマごとの PNG と座標データを保存する。

### ツールウィンドウの設定
- 対象画像カード: 選択中の画像名・保存先・解像度。未選択時は「⚠️ 分割する画像が選択されていません」
  「ARCHIVES で分割する画像を選択してください。」と案内する（背景除去・コマ結合と同じ部品 `features/tools/target-card.ts`）。
- モデル: `Gemini 3.8 Flash`（`gemini-3.8-flash`、標準・高速）/ `Gemini 3.1 Pro`（`gemini-3.1-pro-preview`、高度推論）。
  保存値 `gemini-3.1-pro` は `gemini-3.1-pro-preview` に読み替えて保存し直す。バックエンドも `gemini-3.1-pro` / `gemini-3-pro` を同じ ID に正規化する。
- 推論レベル（thinkingConfig.thinkingLevel）: LOW / MEDIUM / HIGH。
- 読み順: 「左上から右下（ウェブトゥーン・左開き）」（既定）/「右上から左下（日本の漫画・右開き標準）」。
- コマ余白（パディング）: 0〜30px（既定 0）。
- 設定はすべて永続化（`panelSplitter_model` / `_thinking_level` / `_reading_order` / `_padding`）。
- JSON プレビュー: バックエンド（`/api/image/split-panels/preview`）が組み立てた実際の Gemini リクエストと、保存先・出力ファイル・panels.json の例を表示する。

### 検出（バックエンド）
- 画像は送信時だけ長辺 4096px 以下に縮小し JPEG（quality 85）にする（約 20MB の上限対策）。切り出しは元解像度で行う。
- `response_mime_type: application/json` と `response_schema` で、`[{panel_number, box_2d: [ymin, xmin, ymax, xmax]}]`（0〜1000 の正規化整数）を要求する。
  プロンプトで読み順を指定する。temperature 0.1。
- モデルが thinkingConfig / schema を拒否した場合（400 で本文に thinking / schema を含む）は、それらを外して 1 回だけ再送する。
- Thinking 有効時は thought でない最後のテキストパートを解析する（```json の囲みは除去）。
- コマが 0 件なら画像全体を 1 コマとして扱う。幅・高さが 0 になるコマは捨てる。

### 保存
- 保存先は共通ルール（[archives.md](../archives.md)「ツールの結果の保存」）: 選択中アーカイブの中の `YYYYMMDD_HHMMSS_コマ分割/`、
  未選択なら新しいアーカイブ `YYYYMMDD_HHMMSS_コマ分割`。
- 出力: `01.png`, `02.png`, ...（読み順の連番）、`panels.json`、`info.json`（source = 分割した画像のキー、
  settings = `model` / `thinking_level` / `reading_order` / `padding`）。元画像のコピーは保存しない。
- `panels.json`: `version`, `timestamp`, `created_at`, `original_filename`, `image_size {width, height}`, `reading_order`, `model`,
  `thinking_level`, `padding`, `panels_count`, `panels[]`。各コマは `panel_number`, `filename`, `box_2d`（Gemini 正規化）,
  `pixel_box [xmin, ymin, xmax, ymax]`（Pillow / PASCAL VOC）, `xywh [x, y, w, h]`（COCO / OpenCV）, `width`, `height`。
- log.txt は書かない。
- 完了後: 「コマ分割: N コマに分割し、「<結果フォルダ>」に保存しました」のトースト。ARCHIVES を更新して結果フォルダを展開し、`01.png` を選択・表示する。
- 画像が選択されていなければ、実行ボタンを押した時に注意トースト（[notifications.md](../notifications.md)）。

## コマ結合（`features/tools/panel-merge.ts` → `POST /api/image/merge-panels`）
- ARCHIVES で `panels.json` を含むフォルダ（コマ分割で作ったフォルダ）を選択し、ツールウィンドウの「実行」で実行する。
- ツールウィンドウ（設定項目はなし）: 対象フォルダのカードに「対象フォルダ: <キー>」「保存先: <アーカイブ> / [日時]_コマ結合/」と、
  そのフォルダの panels.json の内容「コマ数: N / 結合後の大きさ: W × H px」を出す。panels.json がない・読めない場合はカードに注意を出す
  （実行はできる。実行するとエラートーストになる）。フォルダが選択されていなければ「結合するフォルダが選択されていません」と案内する。
- `panels.json` の `image_size` の透明キャンバスに、各コマを `pixel_box`（なければ `xywh`）の左上位置へ貼り戻す。
- 保存先: 対象フォルダのトップレベルアーカイブの中に `YYYYMMDD_HHMMSS_コマ結合/` を作り、`YYYYMMDD_HHMMSS_コマ結合.png` と
  `info.json`（source = 対象フォルダのキー）を保存する（[archives.md](../archives.md)「ツールの結果の保存」）。
- log.txt は書かない。
- 完了後: 「コマ結合: 「<結果フォルダ>」に結合画像を保存しました」のトースト。結合画像を自動選択・表示する。
- フォルダが選択されていないまま「実行」を押すと注意トースト。panels.json がない・壊れている・コマ画像がない場合はエラートーストで理由を日本語で表示する。
