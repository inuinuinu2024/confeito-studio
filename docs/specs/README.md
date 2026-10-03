# 仕様（決定事項）

機能ごとの振る舞いの決定事項。ユーザーの要望・指摘で仕様が決まったら、指示がなくても該当ファイルを更新する。
変更経緯は書かない（git 履歴を参照）。実装の構造は [../architecture/](../architecture/README.md) を参照。

| ファイル | 範囲 |
|---|---|
| [app-shell.md](./app-shell.md) | 画面構成、メニュー、ショートカット、ブラウザに残すもの（キャッシュ・保存しない）、ステータスバー、起動・終了 |
| [notifications.md](./notifications.md) | トーストの種類と出し方、エラー表示（メッセージと原文）、ツール実行時の通知、ログを書かないこと |
| [archives.md](./archives.md) | ARCHIVES パネルと保存形式、ツールの結果の保存（保存先・名前・info.json）、選択と保存先フォルダ、削除と Undo |
| [canvas.md](./canvas.md) | 表示ルール、ズーム、テキスト表示、Compare / Overlay / Batch モード、背景色、D&D |
| [ai-panel.md](./ai-panel.md) | ツール一覧（並び替え）、ツールウィンドウ（モーダル）、実行、設定の保存 |
| [tools/image-loader.md](./tools/image-loader.md) | 画像読み込み |
| [tools/panel-split-merge.md](./tools/panel-split-merge.md) | コマ分割 / コマ結合 |
| [tools/nano-banana-pro.md](./tools/nano-banana-pro.md) | Nano Banana画像生成（モデル・API の選択、API ごとの項目、保存） |
| [tools/gemini-image.md](./tools/gemini-image.md) | Gemini 画像生成の共通部品（参照画像・プロンプト・API の制約・エラー） |
| [tools/remove-background.md](./tools/remove-background.md) | 背景除去 |
