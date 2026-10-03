# 画面構成・起動・終了

## 画面構成
- アプリ名は「ConfeitO Studio」。上部バー左端・ブラウザのタブのタイトル・起動中画面・起動用ショートカット（`setup/ConfeitO Studio.lnk`）に出す。
  リポジトリ名・パッケージ名（`confeito-studio`）・環境変数（`CONFEITO_*`）などの識別子は小文字のまま。
- CSS Grid（`.manga-grid`）で 4 列 × 3 行: 上段 = トップバー（全幅）、中段 = 表示モードボタン | ARCHIVES | キャンバス | AI パネル、下段 = ステータスバー（全幅）。
- 左サイドバーは ARCHIVES 専用（レイヤーツリーは廃止）。左右のサイドバーは端のドラッグで 150〜600px に変更できる。
- 右サイドバーは AI パネル。Compare モード中のみ 2 つ目の ARCHIVES パネルに置き換わる。
- スタイルは `variables.css` のデザイントークンで一元管理（ダークテーマ）。

## メニューとアクション
- メニューは File / Edit / View / Help。
- File: 項目なし。押すと「開発中」トースト（「「File メニュー」は現在開発中です」）。画像の保存・閉じる機能と、
  前回保存した画像を起動時に開き直す機能は廃止（Ctrl+S / Ctrl+Shift+S もアプリでは扱わない）。
  画像の取り込みは「画像読み込み」ツールとキャンバスへの D&D で行い、結果は ARCHIVES に残る（[archives.md](./archives.md)）。
- Edit: Undo (Ctrl+Z) / Redo (Ctrl+Y)。対象は ARCHIVES の削除操作。
- View: Background Color... (Ctrl+B)。Help は未実装（「開発中」トースト）。
- 右上のアイコン: 設定（Gemini API キーを `.env` に保存）、クラウド同期・アカウント（未実装、「開発中」トースト）。
- ショートカットは入力欄・テキストエリアにフォーカスがある間は無効。

## ブラウザに残すもの
- なし（できる限りブラウザにデータを残さない）。
  - localStorage・sessionStorage・IndexedDB・Service Worker は使わない。画面の状態で次回も残したいもの（ツールの並び順など）は
    バックエンドの設定ファイル（`settings/default_prompts.json`）に保存する。
  - HTTP キャッシュ: バックエンドの全応答と Vite 開発サーバーの全応答を `Cache-Control: no-store` にし、フロントの `fetch` も `cache: 'no-store'` で呼ぶ。
- 以前のバージョンがブラウザに残したデータ（localStorage の `toolOrder` 等、IndexedDB の `ConfeitoStudioDB`）は消さない（読まないだけ）。
- メモリ上の一時データ（ARCHIVES の中身一覧、ツール設定）はページを閉じれば消える。
- Chrome 自体のキャッシュ（JS のコードキャッシュ等）は対象外。本番ビルド（`vite build` / `preview`）は日常起動で使わないので対象外。

## ステータスバー
- 左: ツール実行中は「Running: ツール名...」と進行バー。Gemini ツールは経過秒数を表示する。
- 右: Backend（`/api/health`）、Internet（`navigator.onLine`）、Gemini API キーの有無。Backend と Gemini は 10 秒ごとに確認。

## 起動
- 日常起動は `setup/start-app.ps1`（ショートカットから実行）。WMI でバックエンド・フロントエンドを非表示で起動する。
  - 起動前にポート 48000 / 45173 を使っている残留プロセスを終了する（セルフヒーリング）。
  - 日常起動では `--reload` を付けない（開発時のみ手動で付ける）。
  - ブラウザは start-app.ps1 がポート 45173 の待ち受けを確認してから 1 回だけ開く（`npm run dev` は `--open` を付けない）。
- フロントエンドは起動直後に `/api/health` を 1 秒間隔でポーリングし、応答があるまでスプラッシュ画面を出す。
  応答後に UI を組み立て、ツール設定（`/api/settings/prompts`）とアーカイブ一覧を読み込む。以降の API にリトライ処理はない。

## 終了
- ブラウザの全タブを閉じると、Vite のプラグイン（`closeOnDisconnectPlugin`）が WebSocket 切断を検知し、
  4 秒の猶予後に `/api/shutdown` を呼んで Vite 自身も終了する。最初の接続前やリロード中の一時的な切断では終了しない。
- `/api/shutdown` は Windows では `taskkill /F /T /PID` でプロセスツリーごと終了する（ゾンビプロセス防止）。
