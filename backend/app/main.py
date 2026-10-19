from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import api_router
from app.core.config import settings


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    # Inicjalizacja przy starcie
    yield
    # Sprzątanie przy zatrzymaniu (zamknięcie puli połączeń bazy danych)
    from app.db.session import engine
    await engine.dispose()


app = FastAPI(
    title=settings.PROJECT_NAME,
    description="Bit2Meet API - platforma do wspólnego ustalania terminów spotkań",
    version="0.1.0",
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
)

# Konfiguracja CORS
if settings.BACKEND_CORS_ORIGINS:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.BACKEND_CORS_ORIGINS,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

# Rejestracja routera API
app.include_router(api_router)


@app.get("/", tags=["Root"])
async def root():
    return {
        "name": settings.PROJECT_NAME,
        "version": "0.1.0",
        "docs": "/docs",
        "health": "/api/health",
    }
