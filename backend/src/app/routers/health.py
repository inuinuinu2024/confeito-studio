"""Health check endpoint."""

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
