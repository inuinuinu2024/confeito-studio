# バックエンド設計方針

## レイヤー構成
2層のレイヤードアーキテクチャを採用。
- **Controller層 (`routers/`)**: リクエストの受付・バリデーション・HTTPExceptionへの変換を行う薄いハンドラー。ビジネスロジックは持たない。
- **Service層 (`services/`)**: 機能ごと（archives, psd, settings, generation, system）のビジネスロジックをカプセル化。Webフレームワークへの依存を極力排除。

## API設計・通信方式
- **REST API**: 単発リクエスト（設定取得、PSD保存など）。
- **WebSocket**: 長時間実行される処理（画像生成など）の進捗通知用。

## 生成AIプロバイダー層
画像生成バックエンドは `ImageGenerationProvider` 抽象クラスを介して差し替え可能。
- 実装済み: `GeminiProvider` (Google Imagen APIを用いたマルチモーダル対応)
- 制約: `gemini-3-pro-image` ではメディアごとの解像度指定（`resolution`）は未サポート（400エラーの原因となるため付与しない）。
- タイムアウト: Gemini APIの通信タイムアウトは600秒（10分）。
- **APIエラー伝播**: Gemini API等でセーフティフィルタによるブロックやエラー（400 Bad Request等）が発生した際、バックエンドはAPIから返却された生のJSONレスポンス（`raw_response`）を例外オブジェクトに保持させ、FastAPIのエラーレスポンス（`detail`）にそのまま含めることで、フロントエンドまで情報を欠落させずに伝播させる。

## その他仕様
- 認証不要のローカル専用ツール。APIキー等はプロジェクト直下の `.env` で一元管理し、フロントエンドからは `/api/settings/*` で取得。
- **背景除去**: `rembg[cpu]` パッケージを使用。推論モデルは `models/` ディレクトリに保存。
- **PSD処理**: バックエンドではZIPエクスポート（PNG分解）や高品質レンダリングを担当。
- **アーカイブ管理**:
  - **保存形式**: ZIP圧縮形式から**通常ディレクトリ（フォルダ）形式**に刷新。`archives/{archive_name}/` ディレクトリ配下に直接ファイルが保存される。
  - **追記・蓄積対応**: 既存のアーカイブフォルダへのファイル追加・上書きが高速かつ安全に可能。
  - **ログ追記API (`POST /archives/{archive_name}/log`)**: アーカイブフォルダ内の `log.txt` に対して、作業ログメッセージを逐次追記可能（`append_archive_log`）。
  - **既存ZIPの自動移行**: `archives/` 直下に残っている従来の `.zip` ファイルは、初回アクセス時に同名フォルダとして自動解凍・移行される。
  - **ゴミ箱機能**: 削除時は `archives/.trash/` に移動され、復元APIにより即座に戻すことができる。パストラバーサル防止ガードを実装。
- **コマ分割（Manga Panel Splitting）**:
  - **APIエンドポイント (`POST /api/image/split-panels`)**: アップロードされた漫画画像からGeminiモデルを用いてコマ枠線を自動抽出し、各コマを個別のPNG画像に切り分けてアーカイブ保存する。
  - **モデル選択・推論設定**:
    - **モデル**: `gemini-3.8-flash`（標準・高速）または `gemini-3.1-pro-preview`（`gemini-3.1-pro` からのエイリアス自動正規化対応、高度推論）を選択可能。
    - **推論設定（thinkingConfig）**: `thinkingLevel`（`LOW` / `MEDIUM` / `HIGH`）を設定可能。Thinkingモード有効時も最終テキストパート（非thought部）を正確に抽出してパース。
    - **厳格なスキーマ保証**: `response_mime_type: "application/json"` に加え、`response_schema` を指定して正規化座標 `[ymin, xmin, ymax, xmax]`（0〜1000）を保証。
  - **読み順ソート**: 左上→右下（ウェブトゥーン・左開き標準、デフォルト）および日本のマンガ標準（右上→左下）の順序指定に対応。
  - **画像切り分け**: Pillowを用いて各コマの正規化座標を実ピクセル座標に変換・パディング処理を行い、個別PNG画像としてクロップ。
  - **アーカイブ保存 & 後続Pythonツール連携形式**:
    - **保存先ディレクトリ決定**: `target_folder`（フロントエンドで現在選択中のアーカイブフォルダ）が指定されている場合は、その親アーカイブフォルダ配下に `YYYYMMDD_HHMMSS_コマ分割/` サブフォルダを作成して出力・保存（サブフォルダ内には `log.txt` は出力せず、元フォルダ直下の `log.txt` にのみ追記）。未指定時のみ ARCHIVES 直下に `YYYYMMDD_HHMMSS_コマ分割/` ディレクトリを新規作成。
    - `{prefix}01.png`, `{prefix}02.png`, ...: 連番の各コマ画像（※`origin.png` 保存は不要化）。
    - `{prefix}panels.json`: Pythonツール等で即座にコマ座標・サイズを再利用できるよう、Pillow/PASCAL VOC互換 `pixel_box: [xmin, ymin, xmax, ymax]`、COCO/OpenCV互換 `xywh: [xmin, ymin, width, height]`、Gemini正規化座標 `box_2d: [ymin, xmin, ymax, xmax]` を網羅した構造化メタデータを同梱。
    - `log.txt` (元フォルダ直下): `[YYYY-MM-DD HH:mm:ss] コマ分割ツールを実行し、*コマに分割しました（元ファイル名 *、サブフォルダ名: *）` の一文のみを追記記録。
- **プロセス管理とシャットダウン仕様**:
  - **シャットダウン (`POST /api/shutdown`)**: フロントエンドの全タブクローズ検知時（`closeOnDisconnectPlugin`）に呼び出される。Windows環境では親プロセスやワーカーなどの残留・ゾンビ化を防ぐため、`taskkill /F /T /PID <pid>` を用いてプロセスツリー全体を強制終了する。
  - **日常起動スクリプト (`start-app.ps1`)**:
    - **セルフヒーリング（ポート解放ガード）**: 起動前にバックエンド（ポート48000）およびフロントエンド（ポート45173）をリッスンしている古い残留プロセスを自動検出し、強制終了してポートを確実に解放してからプロセスを生成する。
    - **リロードフラグの分離**: 日常利用スクリプトでは `--reload` を外し、不要なリローダー子プロセスの多重生成を防ぐ（開発時のみ手動コマンドで `--reload` を指定）。
