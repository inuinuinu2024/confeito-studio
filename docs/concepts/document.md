---
type: feature
tags: [document, psd]
worktree_status: idle
active_branch: none
---

# Document Feature

## 設計意図 (Design Intent)
この機能はアプリケーションにおける「ドキュメント（キャンバスの状態、レイヤー構成など）」全体を管理します。
初期バージョンでは、PSDファイル（Photoshop形式）を読み込み、ag-psdを使用してパースし、
他のUIコンポーネント（キャンバス、レイヤーパネル）へデータを展開する役割を担います。

## データフロー (Data Flow)
1. ユーザーが TopBar などでファイルを開くアクションを実行 (`file:open` カスタムイベント発行)
2. `DocumentManager` が隠し `<input type="file">` を用いてユーザーにファイルを選択させる
3. 選択された `.psd` ファイルを `ag-psd` で解析
4. `document:loaded` イベントを発行し、パース済みのデータを全体へブロードキャストする
5. `Canvas` や `LayerPanel` は `document:loaded` イベントを監視して自身の表示を更新する（後続フェーズで実装）

## 関連機能 (Related Features)
- [top-bar](./top-bar.md): 「File」メニューから `file:open` イベントを発行する
- [canvas](./canvas.md): 読み込まれたPSDの画像データを描画する（予定）
- [layer-panel](./layer-panel.md): 読み込まれたPSDのレイヤー構造を表示する（予定）
