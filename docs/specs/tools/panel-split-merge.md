# コマ分割 / コマ結合

## コマ分割（`features/tools/panel-splitter.ts` → `POST /api/image/split-panels`）
漫画ページから Gemini でコマ枠を検出し、コマごとの PNG と座標データを保存する。

### ツールウィンドウの設定
- 対象画像カード: 選択中の画像名・保存先・解像度（複数選択なら枚数と一覧。[ai-panel.md](../ai-panel.md)「まとめて実行」）。
  未選択時は「⚠️ 分割する画像が選択されていません」「キャンバスで対象の画像を選択してください。」と案内する
  （背景除去・コマ結合と同じ部品 `features/tools/target-card.ts`）。
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
- 保存先は共通ルール（[archives.md](../archives.md)「ツールの結果の保存」）: 表示中のアーカイブの中の `YYYYMMDD_HHMMSS_コマ分割/`。
  選択した画像それぞれに 1 回ずつ実行し、1 回ごとに 1 つの結果フォルダを作る。
- 出力: `01.png`, `02.png`, ...（読み順の連番）、`panels.json`、`info.json`（source = 分割した画像のキー、
  settings = `model` / `thinking_level` / `reading_order` / `padding`）。元画像のコピーは保存しない。
- `panels.json`: `version`, `timestamp`, `created_at`, `original_filename`, `image_size {width, height}`, `reading_order`, `model`,
  `thinking_level`, `padding`, `panels_count`, `panels[]`。各コマは `panel_number`, `filename`, `box_2d`（Gemini 正規化）,
  `pixel_box [xmin, ymin, xmax, ymax]`（Pillow / PASCAL VOC）, `xywh [x, y, w, h]`（COCO / OpenCV）, `width`, `height`。
- log.txt は書かない。
- 完了後: 「コマ分割: N コマに分割し、「<結果フォルダ>」に保存しました」のトースト。全コマを選択する。
  開始画像を分割した時は、Workspace に開始画像を出さず、コマを 1 つずつ左端の行に並べる（[flow-canvas.md](../flow-canvas.md)「図の作り」）。
- 画像が選択されていなければ、実行ボタンを押した時に注意トースト（[notifications.md](../notifications.md)）。

## コマ結合（`features/tools/panel-merge.ts` → `POST /api/image/merge-panels`）
- **対象**: Workspace でコマ（またはコマから作った画像。例: 着彩したコマ）を選び、ツールウィンドウの「実行」で実行する。
  選んだ画像から上流をたどった一番近いコマ分割の結果ごとに 1 回結合する（同じコマ分割のコマを何枚選んでも 1 回）。
- **差し替え**: Workspace でそのコマから作った生成画像に「結合」をマークしていれば、その画像で差し替えて貼る
  （[flow-canvas.md](../flow-canvas.md)「コマ結合に使う画像」）。マークがないコマは分割直後の画像（原画）のまま。
  差し替える画像の大きさがコマと違えば、元のコマの画像の大きさに合わせて縮小・拡大する（縦横比は合わせない）。
- ツールウィンドウ（設定項目はなし）: カードに「結合するコマ分割: <N> 件」「保存先: <アーカイブ> / [日時]_コマ結合/」と、
  コマ分割ごとに「対象: <結果フォルダ名>」、panels.json の内容「コマ数: N / 結合後の大きさ: W × H px」、
  「差し替えるコマ（「結合」の画像）: 01.png → <画像名>, …」（なければ「差し替えるコマ: なし（分割したままのコマを貼る）」）を出す。panels.json がない・読めない場合はカードに注意を出す
  （実行はできる。実行するとエラートーストになる）。対象がなければ「⚠️ 結合するコマ分割の結果が選択されていません」と案内する。
- `panels.json` の `image_size` の透明キャンバスに、各コマを `pixel_box`（なければ `xywh`）の左上位置へ貼り戻す。
- 保存先: 表示中のアーカイブの中に `YYYYMMDD_HHMMSS_コマ結合/` を作り、`YYYYMMDD_HHMMSS_コマ結合.png` と
  `info.json`（source = コマ分割の結果フォルダのキー、sources = 貼った画像のキーをコマの順に、settings.panels = 差し替えたコマ
  `{"01.png": "<画像のキー>"}`。差し替えなしなら settings は空）を保存する（[archives.md](../archives.md)「ツールの結果の保存」）。
  API は `POST /api/image/merge-panels` の `overrides`（JSON `{コマのファイル名: 画像のキー}`）。
- log.txt は書かない。
- 完了後: 「コマ結合: 「<結果フォルダ>」に結合画像を保存しました」のトースト。結合画像は Workspace の右「コマ結合後」ペインに大きく表示する（図には出さない）。
- 対象がないまま「実行」を押すと注意トースト。panels.json がない・壊れている・コマ画像がない場合はエラートーストで理由を日本語で表示する。
