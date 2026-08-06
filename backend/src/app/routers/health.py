"""Health check endpoint."""

import os
import signal
import threading
import time
from fastapi import APIRouter

router = APIRouter(tags=["health"])


@router.get("/health")
async def health_check() -> dict:
    """
    サーバーの起動状態を確認するエンドポイント。

    Returns:
        {"status": "ok", "version": "0.1.0"}
    """
    return {
        "status": "ok",
        "version": "0.1.0",
    }


@router.post("/shutdown")
async def shutdown():
    """
    バックエンドサーバーを安全に終了させるエンドポイント。
    フロントエンドが閉じられた際に呼び出されます。
    """
    def suicide():
        time.sleep(0.5)
        # WindowsやUnix環境で安全にプロセスを終了させる
        try:
            os.kill(os.getpid(), signal.SIGTERM)
        except Exception:
            pass

    threading.Thread(target=suicide, daemon=True).start()
    return {"status": "shutting down"}
