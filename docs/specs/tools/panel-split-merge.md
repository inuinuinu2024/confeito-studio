# コマ分割 / コマ結合

## コマ分割（`features/tools/panel-splitter.ts` → `POST /api/image/split-panels`）
漫画ページから Gemini でコマ枠を検出し、コマごとの PNG と座標データを保存する。

### 設定サイドバー
- 対象画像カード: 選択中の画像名・解像度・保存先。未選択時は「分割対象の画像が選択されていません」と案内する。
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
- 保存先フォルダがある場合: そのトップレベルアーカイブの中に `YYYYMMDD_HHMMSS_コマ分割/` を作る
  （サブフォルダが選択されていても、作る場所はトップレベル直下）。ない場合: アーカイブ `YYYYMMDD_HHMMSS_コマ分割` を新規作成。
- 出力: `01.png`, `02.png`, ...（読み順の連番）と `panels.json`。元画像のコピー（origin.png）は保存しない。
- `panels.json`: `version`, `timestamp`, `created_at`, `original_filename`, `image_size {width, height}`, `reading_order`, `model`,
  `thinking_level`, `padding`, `panels_count`, `panels[]`。各コマは `panel_number`, `filename`, `box_2d`（Gemini 正規化）,
  `pixel_box [xmin, ymin, xmax, ymax]`（Pillow / PASCAL VOC）, `xywh [x, y, w, h]`（COCO / OpenCV）, `width`, `height`。
- トップレベルアーカイブの `log.txt` にだけ 1 行追記する（サブフォルダには log.txt を作らない）:
  `[YYYY-MM-DD HH:mm:ss] コマ分割ツールを実行し、Nコマに分割しました（元ファイル名 <名前>、サブフォルダ名: <名前 or なし>）`
- 完了後: 「「フォルダ/サブフォルダ」に N コマを分割保存しました」のトースト。ARCHIVES を更新して親・サブフォルダを展開し、`01.png` を選択・表示する。

## コマ結合（`features/tools/panel-merge.ts` → `POST /api/image/merge-panels`）
- 設定なし。ARCHIVES で `panels.json` を含むフォルダ（コマ分割で作ったフォルダ）を選択して実行する。
- `panels.json` の `image_size` の透明キャンバスに、各コマを `pixel_box`（なければ `xywh`）の左上位置へ貼り戻す。
- 保存先: 対象がサブフォルダならその親フォルダに `YYYYMMDD_HHMMSS_コマ結合.png`。対象がトップレベルならアーカイブ `YYYYMMDD_HHMMSS_コマ結合` を新規作成。
- 元のトップレベルアーカイブの `log.txt` に
  `[YYYY-MM-DD HH:mm:ss] コマ結合ツールを実行し、N個のコマを結合しました（対象フォルダ: <キー>、保存ファイル: <名前>）` を追記（失敗しても結合は成功扱い）。
- 完了後: 結合画像を自動選択・表示する。panels.json がない・壊れている・コマ画像がない場合は理由を日本語で表示する。
