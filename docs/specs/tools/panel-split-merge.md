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
- `response_mime_type: application/json` と `response_schema` で、`[{panel_number, box_2d: [ymin, xmin, ymax, xmax], marker_number}]`
  （box_2d は 0〜1000 の正規化整数、marker_number は手書きのコマ番号の目印。なければ null）を要求する。temperature 0.1。
- プロンプト（`panel_geometry.build_detection_prompt`）で次のように指示する。設定項目はなく、常に自動。
  - **コマ番号の目印**: 作者・編集が書き足した手書きの数字（鉛筆や別の色、コマの隅や外の余白、丸囲みなど）があれば、それを最優先でコマ割りと順番の基準にする。
    目印 1 つがコマ 1 つ（目印が書かれたコマ、またはいちばん近いコマ）に対応する。
    吹き出し・ナレーション・効果音・看板・時計・画面・服などの中の数字、ノンブル、絵と同じタッチの数字は目印ではない。
    本物の目印は 1 からの連番で 1 コマに最大 1 つ、同じ手書きの書き方でそろう。迷ったら目印として扱わない。目印のないコマも検出する。
  - **境界**: 枠線が薄い・途切れている・描かれていない（枠なし・裁ち切り）コマも、構図・コマ間の余白・場面の並びから範囲を推定する。
  - **境界をまたぐもの**: 吹き出し・効果音・装飾・背景が境界をまたいだり余白を埋めていたりしても、コマをつなげず枠も広げない。本来の境界で割り、それらが切れてもよい。
  - **入れ子・重なり**: コマの中のコマ・重なったコマは、外側と内側（重なった側）それぞれの全体を別のコマとして返す。内側を避けて外側を縮めない。
  - 枠は枠線を含むコマの範囲。外の余白にある目印に合わせて枠を広げない。
  - 並び順: 目印があれば目印の番号順、なければ設定の読み順。目印のないコマは読み順で入る位置に置く。
- 返ったコマのうち目印（正の整数の marker_number）が付いたものだけを番号順に並べ替え、目印付きのコマがあった位置に戻す
  （目印のないコマは Gemini が返した読み順の位置のまま。`panel_geometry.order_by_markers`）。連番 01, 02… はこの順で欠番なく振る。
  目印を使ったかどうかはトーストにも panels.json にも出さない（marker_number は保存しない）。
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

## コマの切り直し（`features/flow-canvas/panel-cropper.ts` → `POST /api/image/recrop-panel`）
Workspace でコマの原画をクリックして開くウィンドウから、分割前のページを指定した範囲で切り出し直す（操作は [flow-canvas.md](../flow-canvas.md)「コマの切り直し」）。
- API: form `panel_key`（コマ分割の結果のコマのキー）、`box`（JSON `[xmin, ymin, xmax, ymax]`、分割前のページの画素）。
  範囲は整数に丸めてページの中に収める。ページの外・大きさ 0 はエラー。
- 分割前のページはコマ分割の info.json の `source`。記録がない（新しいアーカイブに分割した時など）・見つからない時はエラー。
  panels.json にそのコマがない時もエラー。
- 保存先: 表示中のアーカイブの中の `YYYYMMDD_HHMMSS_コマ切り直し/` に、コマと同じファイル名の PNG（例: `02.png`）と `info.json`
  （tool = `コマ切り直し`、source = 切り直したコマ（分割時のコマ）のキー、settings = `split`（コマ分割の結果フォルダのキー）・`panel`（コマのファイル名）・
  `pixel_box`（切り出した範囲））。panels.json は書き換えない。
- 同じコマを何度切り直しても source は分割時のコマなので、すべて同じコマの版としてまとまる。

## コマ結合（`features/tools/panel-merge.ts` → `POST /api/image/merge-panels`）
- **対象**: Workspace でコマ（またはコマから作った画像。例: 着彩したコマ）を選び、ツールウィンドウの「実行」で実行する。
  選んだ画像から上流をたどった一番近いコマ分割の結果ごとに 1 回結合する（同じコマ分割のコマを何枚選んでも 1 回）。
- **差し替え**: Workspace でそのコマから作った生成画像に「結合」をマークしていれば、その画像で差し替えて貼る
  （[flow-canvas.md](../flow-canvas.md)「コマ結合に使う画像」）。マークがないコマは分割直後の画像（原画）のまま。
  差し替える画像の大きさがコマと違えば、元のコマの画像の大きさに合わせて縮小・拡大する（縦横比は合わせない）。
- ツールウィンドウ（設定項目はなし）: カードに「結合するコマ分割: <N> 件」「保存先: <アーカイブ> / [日時]_コマ結合/」と、
  コマ分割ごとに「対象: <結果フォルダ名>」、panels.json の内容「コマ数: N / 結合後の大きさ: W × H px」、
  「差し替えるコマ（「結合」の画像・切り直したコマ）: 01.png → <画像名>, 02.png → 切り直し 1, 03.png → <画像名>（切り直し 2の範囲に貼る）, …」
  （なければ「差し替えるコマ: なし（分割したままのコマを貼る）」）を出す。panels.json がない・読めない場合はカードに注意を出す
  （実行はできる。実行するとエラートーストになる）。対象がなければ「⚠️ 結合するコマ分割の結果が選択されていません」と案内する。
- `panels.json` の `image_size` の透明キャンバスに、各コマを `pixel_box`（なければ `xywh`）の左上位置へ貼り戻す。
  面積（元のコマ画像の幅 × 高さ。切り直したコマはその範囲の大きさ）の大きいコマから先に貼る（入れ子なら内側のコマ、部分的に重なるなら小さいコマが上。同じ大きさは連番順）。
- **切り直したコマ**: Workspace で切り直した版を表示中のコマは、その版（または、その版から作って「結合」をマークした画像）を、
  panels.json の範囲ではなく切り直した範囲（コマ切り直しの info.json の `pixel_box`）の位置に、その大きさに合わせて貼る。
  API は `boxes`（JSON `{コマのファイル名: [xmin, ymin, xmax, ymax]}`）。範囲が結合後の画像の外・大きさ 0 はエラー。
- 保存先: 表示中のアーカイブの中に `YYYYMMDD_HHMMSS_コマ結合/` を作り、`YYYYMMDD_HHMMSS_コマ結合.png` と
  `info.json`（source = コマ分割の結果フォルダのキー、sources = 貼った画像のキーをコマの順に、settings.panels = 差し替えたコマ
  `{"01.png": "<画像のキー>"}`、settings.boxes = 切り直したコマの範囲 `{"02.png": [xmin, ymin, xmax, ymax]}`。どちらもなければ settings は空）を保存する（[archives.md](../archives.md)「ツールの結果の保存」）。
  API は `POST /api/image/merge-panels` の `overrides`（JSON `{コマのファイル名: 画像のキー}`）。
- log.txt は書かない。
- 完了後: 「コマ結合: 「<結果フォルダ>」に結合画像を保存しました」のトースト。結合画像は Workspace の右「コマ結合後」ペインに大きく表示する（図には出さない）。
- 対象がないまま「実行」を押すと注意トースト。panels.json がない・壊れている・コマ画像がない場合はエラートーストで理由を日本語で表示する。
