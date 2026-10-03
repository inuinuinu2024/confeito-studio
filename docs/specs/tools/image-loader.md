# 画像読み込み（`features/tools/image-loader.ts`）

- AI パネルのツール。ツールウィンドウは開かず、押すとすぐファイル選択（File System Access API、なければ `<input type=file>`）が開く。
- 1 枚だけ選べる（PNG / JPEG / WebP / BMP / GIF）。キャンセル時は何もしない。
- キャンバスへの画像のドラッグ＆ドロップも同じ処理を行う。
- 処理内容:
  1. アーカイブ `YYYYMMDD_HHMMSS_<画像名>` を作る（画像名は拡張子を除いたベース名で、`\ / : * ? " < > |` を `_` に置換）。
     同じ名前があれば `_2`, `_3` … を付ける。
  2. 元画像を同じファイル名でコピーする（log.txt・info.json は置かない。[archives.md](../archives.md)「ツールの結果の保存」）。
  3. そのアーカイブを保存先フォルダに設定し、ARCHIVES で画像を自動選択してキャンバスに表示する。
- 完了・失敗の通知はツール実行の共通ルール（[notifications.md](../notifications.md)）。ドロップで取り込んだ場合も同じ。
  画像以外のファイルをドロップした場合は注意トースト。
