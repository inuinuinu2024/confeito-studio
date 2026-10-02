"""Confeito-Studio backend — FastAPI application.

Run (from backend/):  uv run python -m uvicorn src.app.main:app --port 48000
"""

import logging

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from . import (
    __version__,
    config,  # noqa: F401  (imported first: loads .env into os.environ)
)
from .errors import AppError
from .routers import archives, generate, health, image
from .routers import settings as settings_router

logger = logging.getLogger(__name__)


def create_app() -> FastAPI:
    app = FastAPI(
        title="Confeito-Studio Backend",
        version=__version__,
        description="Archive storage, Gemini image generation proxy and image processing",
    )

    # Local-only tool: accept the Vite dev server on any localhost port.
    app.add_middleware(
        CORSMiddleware,
        allow_origin_regex=r"^http://(localhost|127\.0\.0\.1)(:\d+)?$",
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.exception_handler(AppError)
    async def handle_app_error(_request: Request, exc: AppError) -> JSONResponse:
        return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})

    @app.exception_handler(Exception)
    async def handle_unexpected_error(_request: Request, exc: Exception) -> JSONResponse:
        logger.exception("Unhandled error", exc_info=exc)
        return JSONResponse(status_code=500, content={"detail": str(exc)})

    for module in (health, archives, image, generate, settings_router):
        app.include_router(module.router, prefix="/api")
    return app


app = create_app()
