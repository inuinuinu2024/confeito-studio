# 仕様（決定事項）

機能ごとの振る舞いの決定事項。ユーザーの要望・指摘で仕様が決まったら、指示がなくても該当ファイルを更新する。
変更経緯は書かない（git 履歴を参照）。実装の構造は [../architecture/](../architecture/README.md) を参照。

| ファイル | 範囲 |
|---|---|
| [app-shell.md](./app-shell.md) | 画面構成、上部バー、ショートカット、設定ウィンドウ、ブラウザに残すもの（キャッシュ・保存しない）、ステータスバー、起動・終了 |
| [notifications.md](./notifications.md) | トーストの種類と出し方、エラー表示（メッセージと原文）、ツール実行時の通知、ログを書かないこと |
| [flow-canvas.md](./flow-canvas.md) | Workspace（処理フローのキャンバス）: 表示するアーカイブ、図の作り（ステップ・線・スタックと候補の切り替え・自動配置）、選択、拡大表示、移動とズーム、削除 |
| [archives.md](./archives.md) | アーカイブの保存形式、保存先（アーカイブのフォルダの指定）、ツールの結果の保存（保存先・名前・info.json）、ゴミ箱と Undo |
| [canvas.md](./canvas.md) | 比較キャンバス: 表示モード、比較する画像（Workspace の選択順）、Parallel / Overlay モード、ズーム、背景色 |
| [prompt-manager.md](./prompt-manager.md) | 登録プロンプト（全ツール共通・保存先 assets/prompts/）、Prompt Manager（カテゴリー・並べ替え・編集・エクスポート / インポート） |
| [character-manager.md](./character-manager.md) | 登録キャラクター（名前・カテゴリー・本文・複数の画像、保存先 assets/characters/）、Character Manager（Prompt Manager との違い・画像の編集・zip のエクスポート / インポート） |
| [cost-monitor.md](./cost-monitor.md) | Cost Monitor（Gemini API の利用料。課金の仕組み、このアプリで使った分の記録と表示、単価、保存先 data/usage.db） |
| [ai-panel.md](./ai-panel.md) | ツール一覧（並び替え）、ツールウィンドウ（モーダル）、実行、まとめて実行、実行の停止、設定の保存 |
| [tools/image-loader.md](./tools/image-loader.md) | 画像読み込み |
| [tools/panel-split-merge.md](./tools/panel-split-merge.md) | コマ分割 / コマ結合 |
| [tools/nano-banana-pro.md](./tools/nano-banana-pro.md) | Nano Banana画像生成（モデル・API の選択、API ごとの項目、保存） |
| [tools/gemini-image.md](./tools/gemini-image.md) | Gemini 画像生成の共通部品（参照画像・プロンプト・API の制約・エラー） |
| [tools/remove-background.md](./tools/remove-background.md) | 背景除去 |
