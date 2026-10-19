from datetime import UTC, datetime, timedelta
from hashlib import sha256

import bcrypt
import jwt

from app.core.config import settings


def hash_secret(value: str) -> str:
    # Pre-hash with a domain separator so bcrypt safely handles long UTF-8 passwords too.
    material = b"bit2meet-bcrypt-sha256:" + sha256(value.encode("utf-8")).digest()
    return bcrypt.hashpw(material, bcrypt.gensalt()).decode("utf-8")


def verify_secret(value: str, hashed_value: str | None) -> bool:
    if not hashed_value:
        return False
    try:
        material = b"bit2meet-bcrypt-sha256:" + sha256(value.encode("utf-8")).digest()
        return bcrypt.checkpw(material, hashed_value.encode("utf-8"))
    except (ValueError, TypeError):
        return False


def create_access_token(user_id: int) -> str:
    now = datetime.now(UTC)
    payload = {
        "sub": str(user_id),
        "iat": now,
        "exp": now + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES),
    }
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.ALGORITHM)
