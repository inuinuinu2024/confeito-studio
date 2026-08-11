# Upcoming Tasks

- `[ ]` **【緊急】バックエンドの起動失敗と "Failed to fetch" 問題の解決**
  - **現状の症状**: ユーザーが `.lnk` ショートカットからアプリを起動し、Nano Banana Pro機能を実行しようとすると `Failed to fetch` エラーが出る。
  - **これまでの調査内容**:
    1. フロントエンドからの `fetch('http://127.0.0.1:8000/api/nano-banana-pro')` がネットワークレベルで失敗している（CORSエラーではなく接続拒否）。
    2. 以前の `backend/src/app/providers/__init__.py` に `provider_factory` の定義が欠落しており `ImportError` が発生していたバグは修正済み。手動の `uv run python -m uvicorn src.app.main:app --port 8000` ではポート8000で正常に待ち受け、HTTP 500 (API Key未設定) などを正しく返せることを確認済み。
    3. ショートカットから裏で起動している `start-app.vbs` が何らかの理由でバックエンド(uvicorn)の起動に失敗している可能性が高い。
    4. 以前 `uv run uvicorn ...` が WindowsのAppLocker等のセキュリティポリシー（`os error 4551`）でブロックされたため、VBSのスクリプトを `uv run python -m uvicorn ...` に修正したが、依然としてユーザー環境では起動していない様子。
  - **明日以降の対応方針（次エージェントへの引継ぎ）**:
    - `.vbs` 経由での実行時、パス（`uv`コマンドが見つからない等）や実行ポリシーによるブロックが発生していないか検証する。
    - `start-app.vbs` のログ（標準出力・標準エラー出力）をファイルにリダイレクトする処理 (`> backend_log.txt 2>&1` など) を追加し、ショートカット実行時に裏で何のエラーが起きているかを可視化する。
    - バックエンドサーバー自体が確実に起動するようになったことを確認したうえで、再度Nano Banana Proのエラーメッセージ処理を確認する。

