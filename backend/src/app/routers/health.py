"""/api/health and /api/shutdown."""

from fastapi import APIRouter

from .. import __version__
from ..services.system_service import trigger_shutdown

router = APIRouter(tags=["health"])


@router.get("/health")
async def health_check() -> dict:
    """Polled by the frontend splash screen and status bar."""
    return {"status": "ok", "version": __version__}


@router.post("/shutdown")
async def shutdown() -> dict:
    """Called by the Vite dev server once every browser tab has been closed."""
    trigger_shutdown(delay=0.5)
    return {"status": "shutting down"}
