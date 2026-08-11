"""Confeito-Studio Backend — FastAPI application."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

import os
from pathlib import Path

# Load project root .env
root_env = Path(__file__).parent.parent.parent.parent / ".env"
if root_env.exists():
    with open(root_env, "r", encoding="utf-8") as f:
        for line in f:
            if "=" in line and not line.strip().startswith("#"):
                k, v = line.strip().split("=", 1)
                if k.strip() not in os.environ:
                    os.environ[k.strip()] = v.strip()

from .routers import health, psd, generate, settings

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
app.include_router(generate.router, prefix="/api")
app.include_router(settings.router, prefix="/api")

