"""Health check endpoint."""

from fastapi import APIRouter
from ..services.system_service import trigger_shutdown

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
    trigger_shutdown(delay=0.5)
    return {"status": "shutting down"}
