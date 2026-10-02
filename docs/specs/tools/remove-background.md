# 背景除去（`features/tools/remove-background.ts` → `POST /api/image/remove-bg`）

- rembg（`rembg[cpu]`、モデル `isnet-anime`）でローカルに背景を透過する。モデルは `.env` の `U2NET_HOME`（`models/`）に置く。
  rembg はバックエンドで初回実行時に読み込み、セッションを使い回す。
- 対象: キャンバスに表示中の画像。
- 設定（`removeBg_*`）:
  - アルファマッチング ON/OFF（既定 ON）: 髪の毛など複雑な境界の精度が上がる。OFF だと輪郭がくっきり切り抜かれる。
  - 前景しきい値 0〜255（既定 240）、背景しきい値 0〜255（既定 10）、浸食サイズ 0〜50（既定 10）。
  - 「初期値へ戻す」で既定値に戻す。
- 保存先: 毎回アーカイブ `YYYYMMDD_HHMMSS_remove-background` を作り、`origin.png`（入力）と `nobg.png`（結果）を保存する。
