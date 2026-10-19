from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from app.core.config import settings
from app.db.session import check_database_connection

router = APIRouter(prefix="/health", tags=["Health"])


class HealthResponse(BaseModel):
    status: str
    app: str
    environment: str


class DatabaseHealthResponse(BaseModel):
    status: str
    database: str


@router.get("", response_model=HealthResponse)
async def get_health() -> HealthResponse:
    """Podstawowy healthcheck aplikacji."""
    return HealthResponse(
        status="ok",
        app=settings.PROJECT_NAME,
        environment=settings.ENVIRONMENT,
    )


@router.get("/db", response_model=DatabaseHealthResponse)
async def get_database_health() -> DatabaseHealthResponse:
    """Weryfikacja łączności z bazą danych PostgreSQL."""
    is_connected = await check_database_connection()
    if not is_connected:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"status": "error", "database": "disconnected"},
        )
    return DatabaseHealthResponse(status="ok", database="connected")
