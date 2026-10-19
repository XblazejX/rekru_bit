import json
from typing import Annotated

from pydantic import BeforeValidator
from pydantic_settings import BaseSettings, SettingsConfigDict


def parse_cors_origins(v: str | list[str]) -> list[str]:
    if isinstance(v, str):
        v = v.strip()
        if v.startswith("[") and v.endswith("]"):
            try:
                return json.loads(v)
            except Exception:
                pass
        return [origin.strip() for origin in v.split(",") if origin.strip()]
    return v


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    PROJECT_NAME: str = "Bit2Meet"
    ENVIRONMENT: str = "development"
    DEBUG: bool = True

    # Baza danych
    POSTGRES_USER: str = "bit2meet_user"
    POSTGRES_PASSWORD: str = "bit2meet_password"
    POSTGRES_DB: str = "bit2meet_db"
    POSTGRES_HOST: str = "localhost"
    POSTGRES_PORT: int = 5432
    DATABASE_URL: str = (
        "postgresql+asyncpg://bit2meet_user:bit2meet_password@localhost:5432/bit2meet_db"
    )

    # Bezpieczeństwo i JWT
    SECRET_KEY: str = "bit2meet-super-secret-jwt-key-change-in-production-minimum-32-characters"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60
    VERIFICATION_CODE_EXPIRE_MINUTES: int = 15

    # SMTP
    SMTP_HOST: str = "smtp.example.com"
    SMTP_PORT: int = 587
    SMTP_USER: str = ""
    SMTP_PASSWORD: str = ""
    SMTP_FROM: str = "noreply@bit2meet.local"
    SMTP_TLS: bool = True

    # CORS i URL
    FRONTEND_URL: str = "http://localhost:3000"
    BACKEND_CORS_ORIGINS: Annotated[list[str], BeforeValidator(parse_cors_origins)] = [
        "http://localhost:3000",
        "http://localhost:5173",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:5173",
    ]


settings = Settings()
