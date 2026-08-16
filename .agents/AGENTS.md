# Confeito-Studio — エージェント向けコンテキスト (Antigravity Vibe Coding)

このファイルは、本プロジェクトを「バイブコーディング」するAIエージェント（Antigravity）向けの作業メモおよびコンテキスト共有ファイルです。
本プロジェクトでは `README.md` を廃止し、すべてのコンテキストをこのファイルに統合しています。エージェントは機能追加や変更を行った際、**必ず自律的にこのファイルを更新**し、最新の開発状況と方針を同期させる義務があります。

> [!CAUTION]
> **【エージェントの絶対遵守ルール】**
> AGENTS.md の更新漏れが多発しています。タスクの最終ステップとして、**必ず作業内容やアーキテクチャの変更点をこのファイル（AGENTS.md）に追記・更新してください**。これを怠ることは重大な規約違反とみなされます。

## セットアップと起動方法

本アプリはWebベースですが、デスクトップアプリと同じ感覚で起動できるように構成されています。

### 初回セットアップ

1. フロントエンドの依存関係をインストール:
   ```bash
   cd frontend
   npm install
   ```
2. バックエンドの依存関係をインストール:
   ```bash
   cd backend
   uv sync
   ```
3. `setup/` フォルダ内にある **`create-shortcut.bat`** を実行します。
4. 作成された `Confeito-Studio.lnk`（ショートカット）を右クリックして**タスクバーにピン留め**します。

### 日常の起動方法

- タスクバーにピン留めしたアイコンをクリックするだけです。
- 起動の仕組み: `.lnk` → `start-app.ps1` → WMI (`Win32_Process.Create`) でバックエンド/フロントエンドを完全にデタッチして非表示（バックグラウンド）で起動。黒い画面は一切表示されず、ブラウザのみが自動で開く。
- ログ出力: デフォルトでは無効（ファイルも生成されない）。トラブルシューティング時は `start-app.ps1` 先頭の `$LOG_ENABLED = $true` に変更すると、`setup/` 内にデバッグログが出力される。
- ブラウザの全タブを閉じるとフロントエンド開発サーバーも自動終了する (`vite.config.ts` のカスタムプラグイン)。バックエンドも連携して自動終了するため、ゾンビプロセスは残らない。

**手動起動用コマンド（開発・デバッグ用）**:
- フロントエンド: `cd frontend && npm run dev`
- バックエンド: `cd backend && uv run python -m uvicorn src.app.main:app --reload --port 8000`

## プロジェクト構成（モノレポ）

```text
confeito-studio/
├── frontend/                  # TypeScript + Vite フロントエンド
│   ├── index.html             # Viteエントリ
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts
│   └── src/
│       ├── app.ts             # エントリポイント（UI組み立て）
│       ├── features/          # 機能ごとのUIコンポーネント群
│       │   ├── ai-panel/      # AIツール用右サイドバー
│       │   ├── canvas/        # 描画キャンバス領域
│       │   ├── layer-panel/   # レイヤーツリー + プロパティインスペクタ
│       │   ├── tools/         # AIツール実装 (1ツール1ファイル)
│       │   └── top-bar/       # ヘッダー
│       └── shared/            # 機能間で共有される依存関係
│           ├── utils/
│           ├── types/         # 共有型定義 (tool.types.ts)
│           └── styles/        # デザイントークン・共通レイアウト用CSS
├── backend/                   # Python (FastAPI) バックエンド
│   ├── src/app/
│   │   ├── main.py            # FastAPI アプリ
│   │   ├── config.py          # 設定（環境変数）
│   │   ├── providers/         # 生成AIプロバイダー（プロバイダーパターン）
│   │   └── routers/           # APIルーター
│   └── pyproject.toml
├── sample/                    # テスト用PSDファイルなど
├── setup/                     # 起動用スクリプト群
│   ├── create-shortcut.bat    # .lnk ショートカット生成 (初回のみ)
│   ├── start-app.ps1          # WMI経由でバックエンド/フロントエンドを起動
│   ├── Confeito-Studio.lnk    # ピン留め用ショートカット
│   └── app-icon.ico           # アプリアイコン
├── .agents/                   # エージェント設定 (AGENTS.md)
└── task.md                    # 次回以降のタスクリスト (TODO)
```

## 技術スタックと設計方針

| 項目 | 選択 |
|------|------|
| フレームワーク | Vite 5 |
| 言語 | TypeScript (strict) |
| スタイリング | Vanilla CSS (CSS Custom Properties) |
| フォント | Inter, Geist (Google Fonts) + Material Symbols Outlined |

- **デザイン**: `variables.css` の Vanilla CSS Custom Properties（デザイントークン）で一元管理
- **コンポーネント**: React/Vue等のフレームワーク不使用。各コンポーネントは `create*()` 関数が HTMLElement を返すDOM APIベースのパターン
- **レイアウト**: CSS Grid (`manga-grid`) で画面全体を3列3行構成に分割
- **自動シャットダウン**: `frontend/vite.config.ts` にカスタムプラグインを導入し、ブラウザの全タブが閉じられると開発サーバーも自動終了する仕組み

## バックエンドアーキテクチャ

### 技術スタックとアーキテクチャ
- **Python 3.11+** / **FastAPI** / **uvicorn**
- **psd-tools**: PSDファイルの保存・エクスポート
- **uv**: パッケージ管理 (pyproject.toml)

**【レイヤードアーキテクチャ (2層構造)】**
- **Controller層 (`routers/`)**: リクエストの受付・バリデーション・HTTPExceptionへの変換を行う薄いハンドラー。ビジネスロジックは持たない。
- **Service層 (`services/`)**: 機能ごと（archives, psd, settings, generation, system）のビジネスロジックをカプセル化。Webフレームワークへの依存を極力排除。

### 通信方式
- **REST API (HTTP)**: PSD保存、設定取得等の単発リクエスト
- **WebSocket**: 画像生成の進捗通知のみ

### PSD処理の役割分担（ハイブリッド方式）
- **フロントエンド (ag-psd)**: PSD読み込み、プレビュー表示、レイヤー操作UI、**PSDファイルの保存(.psd)**
  - *Note*: `ag-psd` はデフォルトで展開後のピクセルデータ総量に2GBのメモリ制限(`totalMemoryLimit`)を設けており、レイヤー数が膨大なPSDファイル（例：200レイヤー以上等）を読み込むとエラーになります。そのため、`DocumentManager.ts` での読み込み時には `{ totalMemoryLimit: undefined }` を指定して制限を無効化しています。
  - *Note*: `ag-psd` の `children` 配列は **上から下（インデックス0が最前面のレイヤー）** の順序で格納されています。UIのレイヤーリストを構築する際はそのままの順序で処理してください。
- **バックエンド (psd-tools)**: ZIPエクスポート (各レイヤーのPNG分解出力)、高品質レンダリング

### 生成AIプロバイダーパターン
画像生成バックエンドは `ImageGenerationProvider` 抽象クラスを介して差し替え可能:
- `GeminiProvider` (実装済み: Google Imagen APIを用いた画像生成・マルチモーダル対応)
- `StabilityAIProvider` (未実装: クラウドAPI)

### ストレージと設定
- **ファイル管理**: ローカルファイルシステム（プロジェクトフォルダ単位）
- **APIキー・環境変数**: フロントエンドの `localStorage` ではなく、プロジェクト直下の `.env` ファイルで一元管理される。フロントエンドは `/api/settings/*` 経由でバックエンドと通信しキーを設定・取得する。
- 認証不要（ローカル専用ツール）

### Gemini Interactions API (`v1beta/interactions`) の仕様について
本プロジェクトでは画像生成に標準の `generateContent` ではなく、最新の Interactions API を使用しています。
エージェントは以下の特殊な仕様に注意してください：
1. **ペイロード構造の違い**: `contents: [{role: "user", parts: [...]}]` ではなく、`input: [{type: "image", data: "BASE64..."}, {type: "text", text: "..."}]` というフラットな配列構造を使用します。
2. **モデル互換性の制限**: `gemini-3-pro-image` モデルでは、メディアごとの解像度指定（`resolution` パラメータ）はサポートされていません。プレビュー用関数を含め、フロントエンド側で `resolution: "ultra_high"` などを付与すると確定で400エラーとなるため注意してください。

### 背景除去ツール (rembg)
- バックエンドの `rembg[cpu]` パッケージを使用し、選択レイヤー（または全体画像）の背景除去を行います。
- 推論モデルのダウンロード先は、プロジェクトごとの管理を容易にするため、ルートの `.env` で `U2NET_HOME` にプロジェクト直下の `models/` ディレクトリを指定しています。
- エンドポイント: `POST /api/image/remove-bg`
- フロントエンド: `frontend/src/features/tools/remove-background.ts`

## SW開発戦略 (TypeScript / バイブコーディング向け)

### 1. ソースコードの構成: Feature-based (Vertical Slice)

技術種別(components/, hooks/, utils/)でトップレベルを分けるのではなく、**機能単位**でトップレベルフォルダを分ける。

```text
frontend/src/
  features/
    user-profile/
      UserProfile.ts
      userProfile.types.ts
      userProfile.api.ts
      userProfile.test.ts
    settings/
      Settings.ts
      settings.types.ts
  shared/
    components/
    utils/
    types/
```

#### 狙い
- 1機能の改修時、AIに読み込ませるファイル範囲を機能フォルダ内に閉じ込められる
- 共通処理は `shared/` に隔離し、機能フォルダからの参照のみに限定(循環依存を避ける)

#### トークン節約のための運用ルール
- 1ファイルは200〜300行以内を目安に抑える
- 機能ごとに型定義ファイルを分離し、他機能の型まで読み込ませない
- barrel file (`index.ts` でのre-export) は多用しない(AIがimportを辿る際に余計なファイルを開く原因になるため)

### 2. まとめ: 使い分け

| 対象 | 形式 |
|---|---|
| tsファイル(実装) | Feature-basedフォルダ構成 |
| 設計・仕様・決定事項 | 本ファイル (`AGENTS.md`) に集約 |
| タスク管理 | プロジェクトルートの `task.md` |
