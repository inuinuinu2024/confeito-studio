# 画面構成・起動・終了

## 画面構成
- アプリ名は「ConfeitO Studio」。上部バー左端・ブラウザのタブのタイトル・起動中画面・起動用ショートカット（`setup/ConfeitO Studio.lnk`）に出す。
  リポジトリ名・パッケージ名（`confeito-studio`）・環境変数（`CONFEITO_*`）などの識別子は小文字のまま。
- CSS Grid（`.manga-grid`）で 4 列 × 3 行: 上段 = トップバー（全幅）、中段 = 表示モードボタン | 左サイドバー | メイン領域 | AI パネル、下段 = ステータスバー（全幅）。
  メイン領域は Workspace では処理フローのキャンバス（[flow-canvas.md](./flow-canvas.md)）、Parallel / Overlay では比較キャンバス（[canvas.md](./canvas.md)）。
- 左端の列（`features/tool-bar/ToolBar.ts`）は上から 4 つのグループ: Workspace（account_tree のアイコン）、Parallel View / Overlay View、
  マネージャー（Archive Manager: inventory_2 / Prompt Manager: chat / Character Manager: person / Object Manager: eyeglasses / Style Manager: brush のアイコン）、
  モニター（Cost Monitor: browse_activity のアイコン）。
  グループの間には細い仕切り線（1px）を引く。
  Archive Manager・Prompt Manager・Character Manager・Cost Monitor は表示モードの 1 つ（[archive-manager.md](./archive-manager.md)・[prompt-manager.md](./prompt-manager.md)・[character-manager.md](./character-manager.md)・[cost-monitor.md](./cost-monitor.md)）。
  ほかのマネージャー（Object / Style）は未実装で、押すと「開発中」トースト（「「Object Manager」は現在開発中です」など）を出すだけ（表示モードは変わらない）。
- 左サイドバーはマネージャー（Prompt Manager・Character Manager）のカテゴリー一覧だけが使い、ほかのモードでは幅 0。
  左右のサイドバーは端のドラッグで 150〜600px に変更できる。
- 右サイドバーは AI パネル。Parallel / Overlay モード中は右サイドバーを閉じてキャンバスを広げる
  （ツールは実行しない。[canvas.md](./canvas.md)「比較する画像」）。
- スタイルは `variables.css` のデザイントークンで一元管理（ダークテーマ）。

## 上部バーとショートカット
- 上部バーは左にアプリ名、右にアイコンだけ。メニュー（File / Edit / View / Help）はない（廃止）。
  - 以前のメニューの機能の置き場所: Undo は Workspace のツールバーの削除ボタンの右のボタンと Ctrl+Z（[archives.md](./archives.md)「削除と Undo」）、
    キャンバスの背景色は設定ウィンドウ。画像の保存・閉じる機能と、前回保存した画像を起動時に開き直す機能は廃止
    （Ctrl+S / Ctrl+Shift+S もアプリでは扱わない）。画像の取り込みは「画像読み込み」ツールと Workspace への D&D で行い、結果はアーカイブに残る。
- 右上のアイコン: 設定（下の「設定ウィンドウ」）、クラウド同期・アカウント（未実装、「開発中」トースト）。
- ショートカット: Ctrl+Z（Undo。ウィンドウ・ダイアログを開いている間は効かない）、Ctrl+B（設定ウィンドウを「背景色指定」のページで開く）。
  Workspace では Delete・Esc・Ctrl+A も使う（[flow-canvas.md](./flow-canvas.md)「選択」「削除」）。

## 別ウィンドウ（`shared/ui/window.ts`）
アプリの上に開くウィンドウはすべてこの形にそろえる（**固定の仕様**。新しく作るウィンドウもこれに従う）。
基準はツールウィンドウ（[ai-panel.md](./ai-panel.md)「ツールの実行」）。
- **見た目**: ツールウィンドウと同じ色（背景 `--color-window`、枠線、角丸、影）。後ろは暗くする。
- **見出し**: 左上にタイトル（必要ならアイコン）、右上に ×。ウィンドウ固有の小さな操作（ズーム・コピーなど）は見出しの × の左に置く。
- **閉じるボタンは置かない**: 閉じる操作は右上の × だけ（「閉じる」「キャンセル」ボタンは置かない）。
  決定・登録など、閉じる以外の操作のボタンは下のフッター（右寄せ）に置く。
- **閉じ方**: ×、Esc（いちばん上のウィンドウだけ）、ウィンドウの外のクリック。確認せずに閉じ、決定していない内容は捨てる。
  ウィンドウの中で押して外で離したドラッグでは閉じない。
- 対象: ツールウィンドウ、設定ウィンドウ、画像の拡大表示、コマの切り直し、アイコンの切り取り、登録したプロンプト / プロンプトを登録、
  登録したキャラクター、JSON プレビュー。
- 対象外: 答えを選ばせる確認ダイアログ（「削除の確認」「上書き」など。ボタンで答え、Esc はキャンセル、外のクリックでは閉じない）。

## 設定ウィンドウ（`features/top-bar/components/SettingsWindow.ts`）
- 右上の歯車で開く、アプリ内の大きなウィンドウ（760 × 520px。画面が小さい時は縮む）。左にページの一覧（ページ名だけ。アイコンは付けない）、右に選んだページの設定項目を出す。
  - 開いている間は背景を暗くし、ほかの操作はできない。閉じ方は右上の ×、Esc、背景（暗い部分）のクリック。
  - 歯車で開いた時は先頭のページ（API）、Ctrl+B で開いた時は「背景色指定」のページを出す。開いている間に Ctrl+B を押すと「背景色指定」に切り替える。
  - ウィンドウ全体の Save / Cancel はない。項目ごとに下の方法で保存する。
- ページ（今後の設定も、このどれかか新しいページに足す）:
  | ページ | 項目 | 保存 |
  |---|---|---|
  | API | Gemini API Key（パスワード欄。説明「Gemini を使うツールで使います。」） | 「保存」ボタン（入力が空の間は押せない）か Enter で `.env` に書く。成功するとトースト「Gemini API Key を .env に保存しました」、欄を空に戻す。失敗はエラートースト「設定を保存できませんでした」。欄の下に状態「保存済み（.env）」「未設定」（取得できない時「状態を取得できませんでした」） |
  | 背景色指定 | キャンバスの背景色（[canvas.md](./canvas.md)） | 色を押した時点で反映し、ユーザー設定に書く |
  | 保存先 | アーカイブのフォルダ（フルパスの入力欄＋「参照…」、「既定に戻す」「変更」。[archives.md](./archives.md)「保存先」） | 「変更」か Enter でその場で切り替え、ユーザー設定に書く |
- 開くたびに状態を読み直す（API キーの有無・保存済みの背景色・アーカイブのフォルダ。API キーの入力欄は空にする）。

### Gemini API キーの扱い（将来の Web 版を含む方針）
- 将来 Web アプリにした時は **利用者が自分のキーを持ち込む方式（BYOK）** にする（運営者のキーで全員分を払う方式にはしない）。
  - キーはサーバー側に利用者ごとに暗号化して保存する（KMS 等で暗号化）。保存後に画面へキーを返さない（表示は「保存済み」や末尾数文字まで）。
  - ブラウザにキーを保存しない（localStorage 等に置いてリクエストごとに送る方式は採らない）。キーの保存・確認の API はログインした本人だけが使える。
- 今（ローカル版）は `.env` の `GEMINI_API_KEY` に平文で保存する。ブラウザへはキーを返さず、有無だけを返す（Web 版でも同じ）。
  - キーの保存・読み出しはバックエンドの 1 つの部品（`services/secret_store.py`）だけが行う。Web 版ではこの部品の中身を利用者ごとの暗号化保存に差し替える。
  - 保存したキーはすぐ使われる（アプリを再起動しなくてよい）。`.env` にキーがない時は、アプリの外で設定した環境変数 `GEMINI_API_KEY` を使う（開発用）。
  - 空白だけのキーは保存しない（400「Gemini API Key を入力してください。」）。
- ショートカットは入力欄・テキストエリアにフォーカスがある間は無効。

## ブラウザに残すもの
- なし（できる限りブラウザにデータを残さない）。
  - localStorage・sessionStorage・IndexedDB・Service Worker は使わない。画面の状態で次回も残したいもの（ツールの並び順など）は
    バックエンドのユーザー設定ファイル（`settings/user_settings.json`。下の「設定の保存」）に保存する。
  - HTTP キャッシュ: バックエンドの全応答と Vite 開発サーバーの全応答を `Cache-Control: no-store` にし、フロントの `fetch` も `cache: 'no-store'` で呼ぶ。
- 以前のバージョンがブラウザに残したデータ（localStorage の `toolOrder` 等、IndexedDB の `ConfeitoStudioDB`）は消さない（読まないだけ）。
- メモリ上の一時データ（アーカイブの処理フロー、Workspace のサムネイル、ツール設定）はページを閉じれば消える。
- Chrome 自体のキャッシュ（JS のコードキャッシュ等）は対象外。本番ビルド（`vite build` / `preview`）は日常起動で使わないので対象外。

## 設定の保存（`shared/state/tool-settings.ts`、`backend/src/app/services/settings_service.py`）
ツールの設定値（パラメータ・プロンプト欄の内容）と画面の状態（ツールの並び順など）は、フラットな文字列マップとして 2 つのファイルに置く。
ユーザーが登録したプロンプトは別のファイル `assets/prompts/prompts.json`、キャラクターは `assets/characters/`（どちらも全ツール共通・git 管理外。仕様は [prompt-manager.md](./prompt-manager.md)・[character-manager.md](./character-manager.md)）。
Gemini の利用記録は `data/usage.db`（SQLite・git 管理外。[cost-monitor.md](./cost-monitor.md)）。

| ファイル | 内容 | git | 書き込み |
|---|---|---|---|
| `settings/default_settings.json` | 初期設定（アプリと一緒に配る値。プロンプトは含めない） | 管理対象 | アプリは書かない（読むだけ） |
| `settings/user_settings.json` | ユーザー設定（使っている人が変えた値） | 除外 | アプリが書く |

- 読み込むと、初期設定の上にユーザー設定を重ねた値になる（同じキーはユーザー設定が優先）。どちらにもないキーはコード内の既定値。
- **読み込むタイミング**: アプリ起動時と、ツールウィンドウを開く時（毎回ファイルから読み直す）。
- **書き込むタイミング**:
  - ツールの設定（プロンプト・モデル・パラメータなど）: 画面で変えた値はメモリ上だけで持ち、**ツールの実行を始めた時**にそのツールの変えた項目だけを書く。
    生成がエラーやブロックで失敗しても、実行を始めていれば保存される。
    実行せずにウィンドウを閉じた変更は、次にツールを開いた時（読み直し）に消え、保存済みの値に戻る。
  - TOOLS の並び順（`aiPanel_toolOrder`）・キャンバスの背景色（`canvas_bgColor`）・Workspace で表示したアーカイブ（`flowCanvas_archive`）・左右のペインの開閉と幅（`flowCanvas_leftOpen` など）: 明示的な操作なので、その場で書く。
  - 登録したプロンプト・キャラクターの変更: その場で `assets/prompts/prompts.json`・`assets/characters/` に書く（ツール設定とは別）。
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
