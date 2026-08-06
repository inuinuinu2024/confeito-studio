"""Confeito-Studio Backend — FastAPI application."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .routers import health, psd

app = FastAPI(
    title="Confeito-Studio Backend",
    version="0.1.0",
    description="Image generation proxy & PSD processing backend for Confeito-Studio",
)

# CORS — ローカル開発用。フロントエンド (Vite) からのリクエストを許可
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",   # Vite dev server
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Routers ──
app.include_router(health.router, prefix="/api")
app.include_router(psd.router, prefix="/api")

