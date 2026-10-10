# ConfeitO Studio アーキテクチャ概要

ローカル専用の漫画着彩ワークスペース。ブラウザで動く UI（Vite + TypeScript）と、
ローカルの FastAPI バックエンド（ファイル保存・Gemini API 中継・画像処理）で構成される。

## プロセスとポート

| プロセス | ポート | 起動 | 役割 |
|---|---|---|---|
| backend (uvicorn) | 48000 | `setup/start-app.ps1` / 手動 | `/api/*`。アーカイブ保存、Gemini 呼び出し、rembg、コマ分割/結合 |
| frontend (Vite dev server) | 45173 | 同上 | UI 配信。全タブが閉じたら backend ごと終了 |

- フロントエンドは `http://127.0.0.1:48000/api` を直接呼ぶ（`VITE_API_BASE` で変更可。E2E は 48100/45273 を使う）。
- バックエンドの CORS は localhost / 127.0.0.1 の任意ポートを許可（ローカル専用・認証なし）。

## データの置き場所（リポジトリ直下）

| パス | 内容 | git |
|---|---|---|
| `archives/` | ユーザーの作業データ（アーカイブ = フォルダ。アプリの内部データで、出し入れは Archive Manager の zip のエクスポート / インポートと Workspace の画像の書き出しで行う。設定ウィンドウの「保存先」で別のフォルダに変えられる）。`.trash/` はゴミ箱（削除したアーカイブと `.items/` に削除したファイル。バックエンド起動時に空にする） | 除外（**消さないこと**） |
| `settings/default_settings.json` | 各ツールの設定の初期値（フラットな文字列マップ。アプリは書かない） | 管理対象 |
| `settings/user_settings.json` | ユーザーが変えた設定値（初期値の上に重ねる。壊れていたら `user_settings.broken-*.json` に退避） | 除外（**消さないこと**） |
| `assets/prompts/prompts.json` | ユーザーが登録したプロンプト（全ツール共通。壊れていたら `prompts.broken-*.json` に退避） | 除外（**消さないこと**） |
| `assets/characters/` | ユーザーが登録したキャラクター（`characters.json` ＋ キャラクターごとの画像フォルダ `<id>/`。全ツール共通。壊れていたら `characters.broken-*.json` に退避） | 除外（**消さないこと**） |
| `data/usage.db` | アプリが自分で付ける記録の置き場 `data/` の、Cost Monitor の Gemini の利用記録（SQLite） | 除外（**消さないこと**） |
| `.env` | `GEMINI_API_KEY` | 除外（秘密情報） |
| `models/` | rembg モデル（isnet-anime.onnx）、キャラクターのアイコン用のアニメ顔検出モデル（anime_face_detect_v1.4_s.onnx。初回使用時に自動でダウンロード） | 除外 |

バックエンドの各パスは `CONFEITO_ARCHIVES_DIR` / `CONFEITO_SETTINGS_DIR` / `CONFEITO_ASSETS_DIR` / `CONFEITO_DATA_DIR` / `CONFEITO_ENV_FILE` で差し替え可能（テストと E2E が一時ディレクトリを使うため）。

## 技術選定理由
- **Vite 5**: 高速な開発体験とビルドのため。
- **TypeScript (strict)**: 型安全性の担保。UI フレームワークは使わず DOM API で組み立てる（軽量・依存が少ない）。
- **Vanilla CSS**: フレームワークに依存せず、デザイントークン（CSS Custom Properties）で一元管理。
- **FastAPI**: 型安全で高速なバックエンド API の構築。
- **rembg (isnet-anime)**: ローカルで完結する背景除去。
- **アニメ顔検出（deepghs/anime_face_detection・YOLOv8s ONNX）**: キャラクターのアイコンの切り取り枠を置くための顔検出。rembg と同じ onnxruntime で CPU 実行する。
- **Gemini API**: 画像生成（Interactions API）とコマ検出（generateContent + JSON スキーマ）。

## ドキュメントの構成
- 設計（どう作られているか）: [frontend.md](./frontend.md) / [backend.md](./backend.md) / [testing.md](./testing.md)
- 仕様（何をどう振る舞うか・決定事項）: [../specs/](../specs/README.md)
- セットアップと起動: [../../setup/README.md](../../setup/README.md)

決定事項のみを記録し、変更経緯は記録しない（経緯は git 履歴）。1 ファイルが 200 行を超えたら分割する。
