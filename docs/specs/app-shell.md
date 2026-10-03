# 画面構成・起動・終了

## 画面構成
- アプリ名は「ConfeitO Studio」。上部バー左端・ブラウザのタブのタイトル・起動中画面・起動用ショートカット（`setup/ConfeitO Studio.lnk`）に出す。
  リポジトリ名・パッケージ名（`confeito-studio`）・環境変数（`CONFEITO_*`）などの識別子は小文字のまま。
- CSS Grid（`.manga-grid`）で 4 列 × 3 行: 上段 = トップバー（全幅）、中段 = 表示モードボタン | ARCHIVES | キャンバス | AI パネル、下段 = ステータスバー（全幅）。
- 左サイドバーは ARCHIVES 専用（レイヤーツリーは廃止）。左右のサイドバーは端のドラッグで 150〜600px に変更できる。
- 右サイドバーは AI パネル。Parallel モード中のみ 2 つ目の ARCHIVES パネルに置き換わる。
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
    バックエンドのユーザー設定ファイル（`settings/user_settings.json`。下の「設定の保存」）に保存する。
  - HTTP キャッシュ: バックエンドの全応答と Vite 開発サーバーの全応答を `Cache-Control: no-store` にし、フロントの `fetch` も `cache: 'no-store'` で呼ぶ。
- 以前のバージョンがブラウザに残したデータ（localStorage の `toolOrder` 等、IndexedDB の `ConfeitoStudioDB`）は消さない（読まないだけ）。
- メモリ上の一時データ（ARCHIVES の中身一覧、ツール設定）はページを閉じれば消える。
- Chrome 自体のキャッシュ（JS のコードキャッシュ等）は対象外。本番ビルド（`vite build` / `preview`）は日常起動で使わないので対象外。

## 設定の保存（`shared/state/tool-settings.ts`、`backend/src/app/services/settings_service.py`）
ツールの設定値（パラメータ・プロンプト欄の内容）と画面の状態（ツールの並び順など）は、フラットな文字列マップとして 2 つのファイルに置く。
ユーザーが登録したプロンプトは別のファイル `settings/prompts.json`（git 管理外。仕様は [tools/gemini-image.md](./tools/gemini-image.md)「プロンプト」）。

| ファイル | 内容 | git | 書き込み |
|---|---|---|---|
| `settings/default_settings.json` | 初期設定（アプリと一緒に配る値。プロンプトは含めない） | 管理対象 | アプリは書かない（読むだけ） |
| `settings/user_settings.json` | ユーザー設定（使っている人が変えた値） | 除外 | アプリが書く |
| `settings/prompts.json` | 登録したプロンプト（ツールごと） | 除外 | 登録・編集・削除の時にアプリが書く |

- 読み込むと、初期設定の上にユーザー設定を重ねた値になる（同じキーはユーザー設定が優先）。どちらにもないキーはコード内の既定値。
- **読み込むタイミング**: アプリ起動時と、ツールウィンドウを開く時（毎回ファイルから読み直す）。
- **書き込むタイミング**:
  - ツールの設定（プロンプト・モデル・パラメータなど）: 画面で変えた値はメモリ上だけで持ち、**ツールの実行を始めた時**にそのツールの変えた項目だけを書く。
    生成がエラーやブロックで失敗しても、実行を始めていれば保存される。
    実行せずにウィンドウを閉じた変更は、次にツールを開いた時（読み直し）に消え、保存済みの値に戻る。
  - TOOLS の並び順（`aiPanel_toolOrder`）: 明示的な操作なので、その場で書く。
  - 登録したプロンプトの登録・編集・削除: その場で `prompts.json` に書く（ツール設定とは別）。
- 書く時は変えた項目だけを送り、バックエンドがユーザー設定に重ねて保存する（ほかの項目・ほかのタブの保存は消えない）。
  ファイルは一時ファイルに書いてから置き換える（途中で失敗しても元のファイルが壊れない）。
- **ファイルが壊れていた時**（JSON として読めない）:
  - ユーザー設定: 上書きせずに `settings/user_settings.broken-<YYYYMMDD_HHMMSS>.json` へ退避し、初期設定で読み込む。
    注意トースト「ユーザー設定ファイル（user_settings.json）が壊れていたため <退避先> に退避し、初期設定で読み込みました。」を出す。
  - 初期設定: ファイルには触らず、コード内の既定値を使う。注意トースト「初期設定ファイル（default_settings.json）を読み込めませんでした。アプリの既定値を使います。」
- 読み込み・保存に失敗した時はエラートースト「ツールの設定を読み込めませんでした」「ツールの設定を保存できませんでした」（原文付き）。
  保存に失敗してもツールの実行は続ける。保存できなかった項目は未保存のまま残り、次の実行時に再び書く。
- API: `GET /api/settings/tools` → `{values, warnings}`、`POST /api/settings/tools`（`{values}` をユーザー設定に重ねる）→ `{warnings}`。
- 以前の初期設定ファイル名は `default_prompts.json`（同梱のプロンプトを含んでいた）。今は `default_settings.json` だけを読む。

## ステータスバー
- 左: ツール実行中は「Running: ツール名...」と進行バー。Gemini ツールは経過秒数を表示する。
- 右: Backend（`/api/health`）、Internet（`navigator.onLine`）、Gemini API キーの有無。Backend と Gemini は 10 秒ごとに確認。

## 起動
- 日常起動は `setup/start-app.ps1`（ショートカットから実行）。WMI でバックエンド・フロントエンドを非表示で起動する。
  - 起動前にポート 48000 / 45173 を使っている残留プロセスを終了する（セルフヒーリング）。
  - 日常起動では `--reload` を付けない（開発時のみ手動で付ける）。
  - ブラウザは start-app.ps1 がポート 45173 の待ち受けを確認してから 1 回だけ開く（`npm run dev` は `--open` を付けない）。
- フロントエンドは起動直後に `/api/health` を 1 秒間隔でポーリングし、応答があるまでスプラッシュ画面を出す。
  応答後に UI を組み立て、ツール設定（`/api/settings/tools`）とアーカイブ一覧を読み込む。以降の API にリトライ処理はない。

## 終了
- ブラウザの全タブを閉じると、Vite のプラグイン（`closeOnDisconnectPlugin`）が WebSocket 切断を検知し、
  4 秒の猶予後に `/api/shutdown` を呼んで Vite 自身も終了する。最初の接続前やリロード中の一時的な切断では終了しない。
- `/api/shutdown` は Windows では `taskkill /F /T /PID` でプロセスツリーごと終了する（ゾンビプロセス防止）。
