# Confeito-Studio (v0.1.0)

ComfyUI連携のマンガPSDエディタ — TypeScript + Vite による純粋なWebアプリケーションです。

## セットアップと起動方法

本アプリはWebベースですが、デスクトップアプリと同じ感覚で起動できるように構成されています。

### 初回セットアップ

1. フロントエンドの依存関係をインストールします。
   ```bash
   cd frontend
   npm install
   ```
2. バックエンドの依存関係をインストールします。
   ```bash
   cd backend
   uv sync
   ```
3. `setup/` フォルダ内にある **`create-shortcut.bat`** をダブルクリックして実行します。
4. 同じ `setup/` フォルダ内に `Confeito-Studio.lnk`（ショートカット）が作成されるので、これを右クリックして**タスクバーにピン留め**します。

### 日常の起動方法

- タスクバーにピン留めしたアイコンをクリックするだけです。
- （裏で自動的にフロントエンドのローカルサーバーが立ち上がり、ブラウザでアプリが開きます。ブラウザを閉じるとサーバーも自動終了します）
- ※現在はバックエンドも必要な場合は、別途手動でバックエンドサーバーを起動する必要があります。

※開発用途で手動起動したい場合は、それぞれのディレクトリでサーバーを起動してください：

**フロントエンド**:
```bash
cd frontend
npm run dev
```

**バックエンド**:
```bash
cd backend
uv run uvicorn src.app.main:app --reload --port 8000
```

## 技術スタック

| 項目 | 選択 |
|------|------|
| フレームワーク | Vite 5 |
| 言語 | TypeScript (strict) |
| スタイリング | Vanilla CSS (CSS Custom Properties) |
| フォント | Inter, Geist (Google Fonts) + Material Symbols Outlined |

## 開発方針 (Antigravity によるバイブコーディング)

本プロジェクトは、AIアシスタント（**Antigravity**）を活用した開発（**バイブコーディング**）に最適化された構成を採用しています。今後の開発フェーズにおいても、Antigravityがこの方針に従って自律的にコードを生成・リファクタし、本 `README.md` や知識ドキュメントを適宜自動で更新していく運用を前提としています。

### 1. Feature-based (Vertical Slice) 構成
UIコンポーネントを技術的要素（components, utilsなど）で分けるのではなく、**「機能（Feature）単位」**で分割しています。これにより、AIに機能修正を指示する際に読み込ませるファイル（トークン数）を最小限に抑えています。

### 2. 知識ドキュメントの分割 (OKF形式)
コードの意図や状態管理のフローなど、AI向けの設計知識は `docs/concepts/` 以下に **OKF (Open Knowledge Format)** のMarkdownとして隔離されています。機能の実装前に、対応するOKFドキュメントをAIに読み込ませることで文脈を与えます。

### 3. Git Worktree 活用前提
1機能＝1フォルダの構成になっているため、Git Worktreeと非常に相性が良いです。各OKFドキュメントには現在作業中のブランチを記録するメタデータが含まれており、複数のAIエージェントを並列で動かす際の競合を防ぐ運用になっています。

## ディレクトリ構成

```text
confeito-studio/
├── frontend/                  # TypeScript + Vite フロントエンド
│   ├── index.html             # Viteエントリ（Google Fonts読み込み）
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
├── .agents/                   # エージェント設定
└── README.md
```

## 設計方針

- **デザイン**: `variables.css` の Vanilla CSS Custom Properties（デザイントークン）で管理
- **コンポーネント**: フレームワーク不使用。各コンポーネントは `create*()` 関数が HTMLElement を返すDOM APIベースのパターン
- **レイアウト**: CSS Grid (`manga-grid`) で3列3行構成
