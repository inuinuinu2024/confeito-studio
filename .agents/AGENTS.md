# Confeito-Studio — エージェント向けコンテキスト (Antigravity Vibe Coding)

このファイルは、本プロジェクトを「バイブコーディング」するAIエージェント（Antigravity）向けの作業メモおよびコンテキスト共有ファイルです。
エージェントは、機能追加やアーキテクチャ変更を行う際、このファイルおよび `README.md` を**自律的に更新**し、最新の開発状況と方針を常に同期させる義務があります。

## プロジェクト構成（モノレポ）

```text
confeito-studio/
├── frontend/          # TypeScript + Vite フロントエンド
│   ├── src/
│   ├── index.html
│   ├── package.json
│   ├── tsconfig.json
│   └── vite.config.ts
├── backend/           # Python (FastAPI) バックエンド
│   ├── src/app/
│   │   ├── main.py        # FastAPI アプリ
│   │   ├── config.py      # 設定（環境変数）
│   │   ├── providers/     # 生成AIプロバイダー（プロバイダーパターン）
│   │   └── routers/       # APIルーター
│   └── pyproject.toml
├── docs/              # 設計ドキュメント（OKF, プロジェクト共通）
├── sample/            # テスト用アセット（共通）
├── setup/             # デスクトップショートカット等
├── .agents/           # エージェント設定
└── README.md
```

## 現在の状態（v0.1.0）

### ✅ 完了済み: UIシェルの構築とWebアプリ化

元の `stitch_manga_ai_psd_editor/code.html`（Tailwind CDNの単一HTMLモックアップ）をベースに、
TypeScript + Vite + Vanilla CSS の**純粋なWebアプリケーション**として再構築が完了しました。
（※ 初期はElectronを使用していましたが、軽量化・汎用化のために削除されました）

**UIの見た目は元のモックアップとほぼ同等に再現済み。**

### ✅ 実装済みのインタラクション（フロントエンドのみ）

- ツールバーアイコンのアクティブ状態クリック切替
- メニュー項目のアクティブ下線クリック切替
- レイヤー一覧のクリック選択ハイライト
- Opacity スライダー → リアルタイム数値更新
- Denoising Strength / CFG Scale スライダー → リアルタイム数値更新
- Compare Mode トグルスイッチ ON/OFF
- ControlNet Adapters トグルスイッチ ON/OFF
- スプリットビュー仕切りのマウスドラッグリサイズ
- Generate ボタンのクリックアニメーション（縮小）

### ❌ 未実装（バックエンド/機能面）

以下は一切未実装。全てUIの見た目だけの状態：

1. **ファイル操作**: PSD読み込み/保存、File/Editメニューの実動作
2. **ComfyUI連携**: WebSocket接続、画像生成リクエスト送信、結果受信
3. **レイヤー管理**: 追加/削除/並び替え/グループ化（現在はハードコードされたダミーデータ）
4. **キャンバス描画**: 実際の画像描画エンジン（Canvas API / WebGL）
5. **Undo/Redo**: 操作履歴
6. **設定画面**: ComfyUI接続先URL設定など
7. **キーボードショートカット**

## 重要な設計判断と方針

- **バイブコーディング主導**: 今後の開発はすべてAntigravity（AIエージェント）によるバイブコーディングを前提とします。設計の意図やアーキテクチャの変更があった場合は、必ず `AGENTS.md` と `README.md` をAI自身が自動で修正してください。
- **Feature-based (Vertical Slice) アーキテクチャ**: `frontend/src/features/` 以下に機能単位でUIコンポーネントを配置します。これによりAIが一度に読み込むべきコード量を減らします。
- **OKFドキュメントとGit Worktree**: `docs/concepts/` に機能ごとの知識を分離し、YAMLフロントマターで作業ブランチのトラッキングを行います。
- **フレームワーク不使用**: React/Vue等は使わず、Vanilla TypeScript + DOM API で構築。
- **CSS変数ベース**: デザイントークンは全て `frontend/src/shared/styles/variables.css` の CSS Custom Properties。
- **自動シャットダウン**: `frontend/vite.config.ts` にカスタムプラグインを導入し、ブラウザの全タブが閉じられると開発サーバーも自動終了する仕組みを入れています。
- **モノレポ構成**: フロントエンド(`frontend/`)とバックエンド(`backend/`)を同一リポジトリ内で分離。`docs/`, `sample/` はプロジェクト共通。

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

## 元のモックアップとの差異

- 元: Tailwind CDN + インラインスタイル → 当アプリ: Vanilla CSS
- 元: 単一HTML → 当アプリ: 機能ごとにディレクトリ分割
- Blend Mode のオプションに `Overlay`, `Soft Light` を追加

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

### 3. git worktreeとの併用

feature-basedな構成はgit worktreeと相性が良い。1機能=1フォルダのため、機能単位でworktreeを分けて複数のAIエージェントに並行作業させやすい。

#### 運用ルール
- **worktreeのディレクトリ命名規則**: featureフォルダ名と対応させる(例: `../repo-feature-user-profile`, `../repo-feature-settings`)
- **`shared/` の扱い**: 複数worktreeが同時に`shared/`を変更すると競合しやすいため、`shared/`の変更は原則メインブランチ側でのみ行い、featureブランチ側からは変更しない(必要ならメイン側に先に反映してからrebase)
- **docs/concepts (OKF) 側でのステータス管理**: 各concept mdに「どのworktree/ブランチが現在作業中か」を記録し、複数のAIエージェントが同じ機能に同時に手を出す事故を防ぐ
- **AIへの指示スコープをworktree単位に限定**: worktreeごとに作業ディレクトリが物理的に分かれるため、「このworktree内の`docs/concepts/xxx.md`と`src/features/xxx/`だけを見て」という指示がしやすく、トークン節約の効果がさらに高まる

### 4. まとめ: 使い分け

| 対象 | 形式 |
|---|---|
| tsファイル(実装) | Feature-basedフォルダ構成 |
| 設計知識・仕様・決定事項 | OKF形式のmdファイル |

コードはコードの流儀、知識文書はOKFの流儀で分離しつつ、ドキュメント→実装の順にAIに読ませる導線を作るのが基本方針。
