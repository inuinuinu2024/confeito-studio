# タスク管理 (TODO)

## 判断待ち（仕様と実装のずれ・既知の制約）
- **Cost Monitor の Google 側の記録（次の段階）**: Cloud Billing の BigQuery エクスポートから API キー全体（プロジェクト単位）の利用額を読む連携。
  前払い（Prepay）の利用分がエクスポートに載るかを実物で確かめてから作る。将来の Web 版（BYOK）では利用者ごとに GCP の許可が要る点も検討する（docs/specs/cost-monitor.md）。

## 完了タスク
- [x] **アーカイブをアプリで出し入れする方式に**: アーカイブはアプリの内部データとし（形式・保存先の設定はそのまま）、表示名を `.archive.json` に分けた（フォルダ名 = ID は変えない。表示名は重ねない）。
  左端のマネージャーに Archive Manager（一覧・検索・開く・名前の変更・zip のエクスポート / インポート・削除と Undo）を追加。インポートは常に新しいアーカイブとして追加し、
  ID が変わった時は info.json と .flow.json のキーを書き換え、サブフォルダの日時も戻す。Workspace のツールバーと拡大表示に画像の書き出し（1 枚はそのまま・複数は zip）。
  書き出し・取り込みは将来の Web 版を見据えてブラウザのダウンロード / ファイル選択に統一（docs/specs/archive-manager.md, archives.md, flow-canvas.md「画像の書き出し」）。
- [x] **Nano Banana画像生成の原画を Image 1 に**: 原画を参照画像より前に送り、原画がある間は参照画像カード・`Inputs/` の番号を Image 2 から。
  送信テキストを見直し: 種類ごとの指示文、★ は「ほかの参照画像より優先して反映」、原画と参照画像の関係、見出し `# 指示`（docs/specs/tools/nano-banana-pro.md, gemini-image.md）。
- [x] **Character Manager の画像ごとの本文と拡大表示**: 画像ごとに本文（`image_texts`）を持ち、ツールでは各画像の説明に入る。サムネイルのクリックで画像を大きく見るだけのウィンドウ（docs/specs/character-manager.md）。
- [x] **ARCHIVES の保存先を設定ウィンドウで変更**: 「保存先」ページでフルパス / 参照…・既定に戻す。中身は移さない、ない時は確認して作る（docs/specs/archives.md「保存先」）。
  設定の「表示」ページは「背景色指定」に改名。Cost Monitor のアイコンを browse_activity に。
- [x] **ズームバーのホーム（100%）を削除**: Fit to Screen と同じ動き（どちらも 100%）だったため、ホームのボタンを外した（docs/specs/canvas.md「ズームとスクロール」）。
- [x] **Cost Monitor（第 1 段階）**: 左端の列に仕切り線と Cost Monitor（browse_activity）を置き、表示モードに。このアプリからの Gemini 呼び出し（HTTP 200）を
  `data/usage.db`（SQLite）に記録し（トークン数と記録時点の単価で計算した USD）、集計はバックエンドの SQL で行い、
  円を優先して表示（USD を添える）。期間（7日 / 30日 / 90日 / 今月 / 全期間）を切り替えて、日ごとの利用料の推移（積み上げ棒）・
  ツール別の合計と 1 回あたりの平均（横棒）・モデル別を表示し、棒をクリックした日の内訳（ツール別・モデル別・実行一覧）を出す。
  円は画面で入力したレートで換算。残高は API で読めないため出さず、Google 側は「未接続」と AI Studio へのリンク（docs/specs/cost-monitor.md）。
- [x] **キャラクターのアイコン**: キャラクターの画像からアニメ顔を検出し、256×256 の PNG アイコンを作って一覧の名前の横に表示（アイコンがなければ人のアイコン）。
  顔検出は YOLOv5s Anime（PyTorch・GPL-3.0）ではなく deepghs/anime_face_detection の YOLOv8s ONNX（MIT）を採用し、rembg と同じ onnxruntime で CPU 実行
  （1 枚 0.2 秒程度。モデルは初回使用時に models/ へ自動ダウンロード）。「アイコンの切り取り」ウィンドウで元画像の選択・顔の選択・枠の移動と拡大縮小ができ、
  アイコンのないキャラクターに画像を追加すると自動で開く。アイコンは画像に含めないのでツールでは送らない（docs/specs/character-manager.md）。
  顔検出中は砂時計を重ねて操作できなくし、「中断」で検出をやめて手動で続けられる。押せないボタン（`.cs-btn:disabled`）が薄く表示されるようにした。
- [x] **Character Manager を作成**: 名前・カテゴリー・プロンプト本文・画像（複数・順番付き）の 4 つで管理し、保存先を `assets/characters/`
  （`characters.json` ＋ キャラクターごとの画像フォルダ）に。必須は名前だけ。Prompt Manager と同じ表示モード・カテゴリー操作・並べ替え・複製・検索に加え、
  編集欄で画像の追加・並べ替え・削除（保存まで未保存扱い）、zip でのエクスポート / インポート。Nano Banana画像生成 の参照画像から呼び出せ、
  画像は Character 種類・説明に名前と本文が入る（画像のないキャラクターは本文をプロンプトに追記）。ツールからの登録はなし。
  カテゴリー一覧の部品と見た目を Prompt Manager と共通化した（docs/specs/character-manager.md, tools/gemini-image.md）。
- [x] **プロンプトを全ツール共通にし、Prompt Manager で管理できるように**: 名前・カテゴリー・本文の 3 つで管理し、保存先を `assets/prompts/prompts.json` に。
  Prompt Manager は表示モードの 1 つ（左にカテゴリー、キャンバスの場所に一覧と編集欄）。手動の並べ替え・D&D でカテゴリー移動・検索・複製・
  カテゴリー名の一括変更（統合）・エクスポート / インポート。ツールからは登録（カテゴリー付き）と呼び出し（絞り込み・検索・使う）だけ。
  以前の `settings/prompts.json`（ツールごと）は読まない（docs/specs/prompt-manager.md）。
- [x] **Gemini API キーの保存を 1 つの部品にまとめた**: 将来の Web 版は利用者がキーを持ち込む方式（BYOK）に決定。
  ローカル版は保存先を `.env` のまま、読み書きを `services/secret_store.py` に集め、プロセスの環境変数を書き換えないように
  （docs/specs/app-shell.md「Gemini API キーの扱い」）。Windows の資格情報マネージャーへの移行は見送り。
- [x] **表示モードボタンの並びを見直し**: 上から Normal、Batch、仕切り線、Parallel、Overlay。Batch は開くたびに「Batch モードは現在修正中です」の案内トーストを出す（docs/specs/canvas.md「表示モード」）。
- [x] **Parallel Mode も右サイドバーをなくし、L / R のチェック列で選ぶように**: 2 つ目の ARCHIVES パネル（`:right` のイベント）を廃止。
  開始時は L も R も空、同じ画像を両方にできる、テキストは表示しない、削除ボタンを使えるように（消えた L/R は外す）。
  チェック列の仕組みを Overlay（U/T）と共通にし、チェックはすべて四角に（docs/specs/canvas.md「チェック列」）。
- [x] **Overlay Mode の仕様を精査**: T（上絵）も U と同じく ARCHIVES のチェック（U/T の 2 列）で選ぶようにし、行クリック・テキスト選択では表示が変わらないように。
  開始時は選択中の画像を U・T は空にし、抜けると外す。Overlay 中は右サイドバーを閉じ、ツールと D&D の取り込みを無効に。
  背景の塗り範囲を U と T の外接サイズに、矢印キーは T の選択中だけ奪う、U/T の読み込みは最新だけ反映・削除されたら外す、
  T の選択枠の線幅を表示倍率に合わせる、位置リセットのアイコンをズームのホームと区別、ティントに「なし」を追加（docs/specs/canvas.md）。
- [x] **Compare Mode を Parallel Mode に作り直し**: 左右の枠（ペイン）を固定して 1px の境界線を引き、パン・ズームは中の画像に同期してかける。
  100% は 1 ペインに収まる大きさ（以前は 2 ペインで幅を分けて半分に縮小していた）。解像度の違う画像は実寸比のまま。
  選択のないペインはそのペインに案内を出す（左の画像で埋めない）。Slider の境界線は画面に固定し、1px の半透明グレーに。
  右の ARCHIVES の選択が保存先フォルダを書き換えていたバグを修正。内部名も `parallel`（`parallel-mode:toggle`）に（docs/specs/canvas.md）。
- [x] **デフォルトプロンプトを廃止し、プロンプトを複数登録できるように**: ツールごとに名前を付けて登録・使う・編集・削除（`settings/prompts.json`、`/api/prompts/{tool}`）。
  パラメータの保存（実行時に user_settings.json）とは分け、初期設定ファイルを `default_settings.json` に改名してプロンプトを外した。
  空のプロンプトでは実行しない（docs/specs/tools/gemini-image.md「プロンプト」）。
- [x] **ツール名「Nano Banana」→「Nano Banana画像生成」**: 一覧・ウィンドウの見出し・トースト・結果フォルダ名。モデルの通称（Nano Banana など）は変えない（docs/specs/tools/nano-banana-pro.md）。
- [x] **アプリ名を「ConfeitO Studio」に**: 上部バー・タブのタイトル・起動中画面・バックエンドのタイトル・ドキュメント・起動用ショートカット名（docs/specs/app-shell.md）。
- [x] **参照画像の「キャンバス追加」ボタンを削除**: 追加はファイル選択かドラッグ＆ドロップのみ（docs/specs/tools/gemini-image.md）。
- [x] **参照画像の上限を合計枚数だけに**: 種類ごとの枚数は推奨の目安（超えても選べる・黄色表示）。合計の上限は種類ごとの推奨枚数の和（Pro 14 枚）。
  モデル変更時はない種類を最初の種類に変え、合計を超える分は後ろから外す（docs/specs/tools/gemini-image.md）。
- [x] **参照画像の入力エリアを見直し**: 種類ごとの枠をやめて 1 つの一覧に。画像ごとのカードで種類・★・説明テキスト・順番（ドラッグ）を設定でき、
  説明は送る文章の `# Image N` の下に入る（docs/specs/tools/gemini-image.md）。並べ替えの部品は `shared/ui/drag-sort.ts` に共通化。
- [x] **Nano Banana のウィンドウを 3 列に**: 左「モデルと API」＋プロンプト、中央 参照画像、右 そのほかのパラメータ＋JSON プレビュー（幅 1200px、列ごとにスクロール）。
  「1.」の番号と「2. 生成設定」の表示を削除。ツールウィンドウに複数列の仕組み（`Tool.windowColumns`）を追加（docs/specs/tools/nano-banana-pro.md）。
- [x] **背景除去のウィンドウにも対象画像カード**: 未選択時は「⚠️ 背景を除去する画像が選択されていません」。コマ分割・コマ結合とカードの部品を共通化（`features/tools/target-card.ts`）。
- [x] **コマ結合もツールウィンドウを開く**: 対象フォルダ・保存先・panels.json の内容（コマ数・結合後の大きさ）を確認してから「実行」（docs/specs/tools/panel-split-merge.md）。
- [x] **ツール名「Nano Banana Pro」→「Nano Banana」、実行ボタンの文言を全ツール「実行」に**: 内部の id・設定キー `nanoBananaPro_*`・API のパスは旧名のまま（docs/specs/tools/nano-banana-pro.md, ai-panel.md）。
- [x] **ツールを開いた時の表示をアプリ内のモーダルウィンドウに**: 画面中央・幅 480px 固定・高さは中身に合わせる。開いている間はほかの操作不可。
  × / Esc / 背景クリックで閉じる。実行中は実行ボタンを無効化（docs/specs/ai-panel.md）。
- [x] **ブラウザにキャッシュを残さない**: localStorage・IndexedDB を使わない（ツールの並び順は settings/default_prompts.json の `aiPanel_toolOrder` へ）。
  バックエンド・Vite 開発サーバーの全応答を `Cache-Control: no-store` にし、fetch も `cache: 'no-store'`。以前のブラウザのデータは消さない（docs/specs/app-shell.md）。
- [x] **`.env` の `U2NET_HOME=models` を不要に**: rembg のモデル置き場は既定でリポジトリの `models/`（`CONFEITO_MODELS_DIR` で変更可）。`U2NET_HOME` を指定した場合はそちらが優先。
- [x] **File メニューの中身を削除**: Save Image / Save Image As... / Close Image、Ctrl+S / Ctrl+Shift+S、前回保存した画像を起動時に開き直す機能（IndexedDB）を廃止。
  File の見出しは残し、押すと「開発中」トーストを出す（docs/specs/app-shell.md）。
- [x] **ツールの結果の保存ルールを統一**: 全ツール、選択中アーカイブの中の `<日時>_<ツール名>/` に保存（未選択なら新アーカイブ）。結果フォルダに info.json（ツール名・日時・元画像・設定・出力）を置き、
  入力のコピー（背景除去の origin.png）はやめた。保存後は結果の画像を自動で選択・表示する。同名は `_2`… で上書きしない。選択を外すと保存先も空になる（docs/specs/archives.md）。
- [x] **トースト・ログの統一**: トーストは縦に積み、成功・注意・案内は 4 秒、エラーは × で閉じるまで残す。エラーは日本語メッセージと原文（HTTP ステータス・Gemini の応答・例外）を出し、コピーできる。
  ツール実行の通知は共通処理が 1 回だけ出す（成功は結果の要約つき、画像未選択などは注意で失敗扱いにしない）。log.txt / error.txt の書き込みと `/api/archives/{name}/log` を廃止。
  バックエンドのエラーメッセージを日本語にし、アプリ全体のトーストも日本語にした（docs/specs/notifications.md）。
- [x] **右サイドバー（AI パネル）の Custom タブとピン留めを削除**: ツール一覧は見出し「TOOLS」の下に全ツールを 1 列で並べ、ドラッグ並び替え（`toolOrder`）だけを残した（docs/specs/ai-panel.md）。
- [x] **着彩（シングル）・着彩（マルチ）・Nano Banana 2（未作成）をいったん削除**: ツール本体と、それだけが使っていた部品（縦横比の余白計算、原画ゾーン、`?return_json=true`）を削除した。着彩ツールの safetySettings の判断待ちは取り下げ。設定ファイルに残る `coloring_*` のキーは使われない（ユーザーデータなので消していない）。
- [x] **Nano Banana Pro のモデル・API 選択**: モデル（4 種）と API（Interactions / generateContent）を先に選び、その組み合わせで使える項目だけを設定する画面にした。各項目に「既定（送らない）」がある（docs/specs/tools/nano-banana-pro.md）。
- [x] **Batch モードの選択**: 複数選択は選んだファイルだけをツリー順にグリッド表示、ファイル 1 つは 1 枚のグリッド（docs/specs/canvas.md）。
- [x] **ズーム 100% の意味を決定**: 「表示領域に収まる大きさ = 100%」を正とする（docs/specs/canvas.md）。
- [x] **削除の Undo をゴミ箱経由に**: アーカイブ内のファイル・サブフォルダも `.trash/.items/` に移し、Ctrl+Z で戻せるようにした（docs/specs/archives.md）。
- [x] **コマ分割ツール（Panel Splitter）の新規作成**
  - バックエンド: Gemini API (`gemini-3.6-flash`) による漫画コマ（frames）の自動検出と構造化JSON座標抽出 (`panel_service.py`)
  - バックエンド: Pillowによる各コマの切り分け（クロップ）と連番PNG（`01.png`, `02.png`...）の生成
  - バックエンド: `YYYYMMDD_HHMMSS_コマ分割/` ディレクトリ作成、元画像（`origin.png`）および詳細ログ（`log.txt`）の自動保存
  - バックエンド: APIエンドポイント `POST /api/image/split-panels` の追加
  - フロントエンド: `PanelSplitterTool` の実装（UI設定: 読み順選択、余白スライダー、状態カード、初期化ボタン）
  - フロントエンド: `AIPanel.ts` へのツール登録およびARCHIVES自動更新・1コマ目自動選択表示
- [x] **コマ分割ツールの保存先（サブフォルダ構成）・元フォルダへのログ1行追記・origin.png除外**
  - バックエンド: `target_folder`（選択中フォルダ）配下に `YYYYMMDD_HHMMSS_コマ分割/` サブフォルダを自動作成し、各コマ（`01.png`...）および `panels.json` を保存（`origin.png` の保存は不要化）
  - バックエンド: サブフォルダ内には `log.txt` を出力せず、元フォルダ直下の `log.txt` に `[YYYY-MM-DD HH:mm:ss] コマ分割ツールを実行し、*コマに分割しました（元ファイル名 *、サブフォルダ名: *）` の一文のみを追記
  - フロントエンド: 設定UIおよびJSONプレビューの出力ファイル一覧から `origin.png` を除外し、ログ保存先説明と同期
  - フロントエンド: ARCHIVESパネルで親フォルダとサブフォルダを自動展開し、1コマ目（`01.png`）を自動選択・表示
  - ドキュメント更新: `frontend.md` および `backend.md` に仕様決定事項を記録
