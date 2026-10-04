"""ConfeitO Studio backend — FastAPI application.

Run (from backend/):  uv run python -m uvicorn src.app.main:app --port 48000
"""

import logging
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from starlette.concurrency import run_in_threadpool

from . import (
    __version__,
    config,  # imported first: loads .env into os.environ
)
from .errors import UNEXPECTED_ERROR_MESSAGE, AppError, exception_text
from .routers import archives, characters, generate, health, image, local_files, prompts
from .routers import settings as settings_router
from .services import archive_service

logger = logging.getLogger(__name__)

# The browser must not keep anything from this app (docs/specs/app-shell.md 「ブラウザに残すもの」).
NO_STORE = {"Cache-Control": "no-store"}


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    # Deleted items are only undoable within one session (docs/specs/archives.md 「削除と Undo」).
    await run_in_threadpool(archive_service.empty_trash)
    # Where the registered prompts are kept (docs/specs/prompt-manager.md 「保存先」), there from the start.
    config.settings.prompts_file.parent.mkdir(parents=True, exist_ok=True)
    # Where the registered characters are kept (docs/specs/character-manager.md 「保存先」).
    config.settings.characters_dir.mkdir(parents=True, exist_ok=True)
    yield


def create_app() -> FastAPI:
    app = FastAPI(
        title="ConfeitO Studio Backend",
        version=__version__,
        description="Archive storage, Gemini image generation proxy and image processing",
        lifespan=lifespan,
    )

    # Local-only tool: accept the Vite dev server on any localhost port.
    app.add_middleware(
        CORSMiddleware,
        allow_origin_regex=r"^http://(localhost|127\.0\.0\.1)(:\d+)?$",
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["X-File-Name"],  # name of the image chosen in the file dialog (local_files.py)
    )

    @app.middleware("http")
    async def no_store(request: Request, call_next: Callable[[Request], Awaitable[Response]]) -> Response:
        response = await call_next(request)
        response.headers.update(NO_STORE)
        return response

    @app.exception_handler(AppError)
    async def handle_app_error(_request: Request, exc: AppError) -> JSONResponse:
        return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})

    @app.exception_handler(Exception)
    async def handle_unexpected_error(_request: Request, exc: Exception) -> JSONResponse:
        logger.exception("Unhandled error", exc_info=exc)
        detail = {"message": UNEXPECTED_ERROR_MESSAGE, "raw_response": exception_text(exc)}
        # Returned outside the middleware stack, so the no-store header is added here too.
        return JSONResponse(status_code=500, content={"detail": detail}, headers=NO_STORE)

    for module in (health, archives, image, generate, settings_router, prompts, characters, local_files):
        app.include_router(module.router, prefix="/api")
    return app


app = create_app()
