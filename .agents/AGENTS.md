# Confeito-Studio — エージェント向けコンテキスト (Antigravity Vibe Coding)

このファイルは、本プロジェクトを「バイブコーディング」するAIエージェント（Antigravity）向けの作業メモおよびコンテキスト共有ファイルです。
本プロジェクトでは `README.md` を廃止し、すべてのコンテキストをこのファイルに統合しています。エージェントは機能追加や変更を行った際、**必ず自律的にこのファイルを更新**し、最新の開発状況と方針を同期させる義務があります。

> [!CAUTION]
> **【エージェントの絶対遵守ルール】**
> AGENTS.md の更新漏れが多発しています。タスクの最終ステップとして、**必ず作業内容やアーキテクチャの変更点をこのファイル（AGENTS.md）に追記・更新してください**。これを怠ることは重大な規約違反とみなされます。

## セットアップと起動方法

セットアップおよび日常的な起動方法の詳細については、以下のドキュメントを参照してください。
- [セットアップと起動方法](../setup/README.md)

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
│   ├── README.md              # セットアップと起動方法
│   ├── create-shortcut.bat    # .lnk ショートカット生成 (初回のみ)
│   ├── start-app.ps1          # WMI経由でバックエンド/フロントエンドを起動
│   ├── Confeito-Studio.lnk    # ピン留め用ショートカット
│   └── app-icon.ico           # アプリアイコン
├── docs/                      # ドキュメント
│   └── architecture/          # アーキテクチャ・設計方針
│       ├── README.md
│       ├── frontend.md
│       └── backend.md
├── .agents/                   # エージェント設定 (AGENTS.md)
└── task.md                    # 次回以降のタスクリスト (TODO)
```

## 技術スタックと設計方針

技術選定、アーキテクチャ、設計仕様に関する決定事項は以下のドキュメントを参照してください。

- [全体アーキテクチャ](../docs/architecture/README.md)
- [フロントエンド設計方針](../docs/architecture/frontend.md)
- [バックエンド設計方針](../docs/architecture/backend.md)
