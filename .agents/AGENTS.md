# Confeito-Studio — エージェント向けコンテキスト (Antigravity Vibe Coding)

このファイルは、本プロジェクトを「バイブコーディング」するAIエージェント（Antigravity）向けの作業メモおよびコンテキスト共有ファイルです。
本プロジェクトでは `README.md` を廃止し、すべてのコンテキストをこのファイルに統合しています。エージェントは機能追加や変更を行った際、**必ず自律的にこのファイルを更新**し、最新の開発状況と方針を同期させる義務があります。

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
- （裏で自動的にフロントエンドのローカルサーバーが立ち上がり、ブラウザでアプリが開きます。ブラウザを閉じるとサーバーも自動終了します）
- ※現在はバックエンドが必要な場合は、別途手動でバックエンドサーバーを起動する必要があります。

**手動起動用コマンド**:
- フロントエンド: `cd frontend && npm run dev`
- バックエンド: `cd backend && uv run uvicorn src.app.main:app --reload --port 8000`

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
│       │   ├── ai-panel/      # ComfyUIコントロール
│       │   ├── canvas/        # 描画キャンバス領域
│       │   ├── layer-panel/   # レイヤーツリー + プロパティインスペクタ
│       │   ├── status-bar/    # フッター
│       │   ├── toolbar/       # 左ナビレール
│       │   └── top-bar/       # ヘッダー
│       └── shared/            # 機能間で共有される依存関係
│           ├── utils/
│           └── styles/        # デザイントークン・共通レイアウト用CSS
├── backend/                   # Python (FastAPI) バックエンド
│   ├── src/app/
│   │   ├── main.py            # FastAPI アプリ
│   │   ├── config.py          # 設定（環境変数）
│   │   ├── providers/         # 生成AIプロバイダー（プロバイダーパターン）
│   │   └── routers/           # APIルーター
│   └── pyproject.toml
├── docs/                      # 設計ドキュメント (OKF, プロジェクト共通)
│   └── concepts/
├── sample/                    # テスト用PSDファイルなど
├── setup/                     # 起動用ショートカット生成スクリプト等
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

## 現在の状態（v0.1.0）

### ✅ 完了済み: UIシェルの構築とWebアプリ化

元の `stitch_manga_ai_psd_editor/code.html`（Tailwind CDNの単一HTMLモックアップ）をベースに、TypeScript + Vite + Vanilla CSS の純粋なWebアプリケーションとして再構築が完了しました。（Electronから移行済み）

### ✅ 実装済みの機能・インタラクション（フロントエンドのみ）

- ツールバーアイコン、メニュー項目のアクティブ切替
- リアルタイム数値更新（Opacity, Denoising Strength, CFG Scale等）
- ControlNet Adapters トグルスイッチ ON/OFF
- Generate ボタンのクリックアニメーション
- **CACHEパネル（IndexedDB連動）**: 
  - ツールの実行結果をキャッシュして一覧表示
  - キャッシュ画像の選択/非選択（レイヤーツリーと統一されたクリック挙動）
  - 名前変更機能（ダブルクリックでInput要素によるリネーム）
  - 複数選択対応 (Ctrl/Shift)
- **キャンバスのCompare Mode（比較表示）**:
  - Compare Mode ON: 元画像とキャッシュ画像を重ね合わせ（Overlay）、ドラッグ可能なスプリットバーでワイプ比較できるUI（Image Comparison Slider）
  - Compare Mode OFF: 元画像とキャッシュ画像を左右に並べて表示（Side-by-Side）

### ❌ 未実装（バックエンド/機能面）

以下は一切未実装。全てUIの見た目（ダミー）だけの状態：

1. **ファイル操作**: PSD読み込み/保存、File/Editメニューの実動作
2. **ComfyUI連携**: WebSocket接続、画像生成リクエスト送信、結果受信
3. **レイヤー管理**: 追加/削除/並び替え/グループ化（現在はハードコードされたダミーデータ）
4. **キャンバス描画**: 実際の画像描画エンジン（Canvas API / WebGL）※現在は背景に画像を表示しているのみ
5. **Undo/Redo**: 操作履歴
6. **設定画面**: ComfyUI接続先URL設定など
7. **キーボードショートカット**

## バックエンドアーキテクチャ

### 技術スタック
- **Python 3.11+** / **FastAPI** / **uvicorn**
- **psd-tools**: PSDファイルの保存・エクスポート
- **uv**: パッケージ管理 (pyproject.toml)

### 通信方式
- **REST API (HTTP)**: PSD保存、設定取得等の単発リクエスト
- **WebSocket**: 画像生成の進捗通知のみ

### PSD処理の役割分担（ハイブリッド方式）
- **フロントエンド (ag-psd)**: PSD読み込み、プレビュー表示、レイヤー操作UI、**PSDファイルの保存(.psd)**
- **バックエンド (psd-tools)**: ZIPエクスポート (各レイヤーのPNG分解出力)、高品質レンダリング

### 生成AIプロバイダーパターン
画像生成バックエンドは `ImageGenerationProvider` 抽象クラスを介して差し替え可能:
- `ComfyUIProvider` (ローカルComfyUI)
- `StabilityAIProvider` (クラウドAPI)
- 他の生成AI (Google Imagen等)

### ストレージ
- ローカルファイルシステム（プロジェクトフォルダ単位）
- 認証不要（ローカル専用ツール）

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

### 2. 設計知識・ドキュメントの構成: OKF (Open Knowledge Format)

**tsファイル自体はOKF化しない。** OKFは実行可能なソースコードではなく、静的な知識・仕様ドキュメントを対象にしたフォーマットのため。
代わりに、各機能の「設計意図・データフロー・関連機能」をOKF形式(YAMLフロントマター付きMarkdown)でドキュメント化し、コードと併走させる。

```text
docs/
  concepts/
    user-profile.md   # frontmatter: type: feature, tags: [profile]
    auth-flow.md
```

#### 使い方
- AIへの指示時、まず `docs/concepts/xxx.md` を読ませてから該当する `frontend/src/features/xxx/` を読ませることで、実装ファイルを総当たりで読ませるより大幅にトークンを節約できる

### 3. まとめ: 使い分け

| 対象 | 形式 |
|---|---|
| tsファイル(実装) | Feature-basedフォルダ構成 |
| 設計知識・仕様・決定事項 | OKF形式のmdファイル |
| タスク管理 | プロジェクトルートの `task.md` |

コードはコードの流儀、知識文書はOKFの流儀で分離しつつ、ドキュメント→実装の順にAIに読ませる導線を作るのが基本方針。
