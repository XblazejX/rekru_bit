import secrets
from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import get_current_user
from app.core.config import settings
from app.core.security import create_access_token, hash_secret, verify_secret
from app.db.session import get_db
from app.models.user import User
from app.schemas.user import (
    ForgotPassword,
    ResetPassword,
    TokenResponse,
    UserDelete,
    UserLogin,
    UserRegister,
    UserResendCode,
    UserResponse,
    UserUpdate,
    UserVerify,
)
from app.services.email import send_auth_code

router = APIRouter(prefix="/auth", tags=["Authentication"])
DbSession = Annotated[AsyncSession, Depends(get_db)]
CurrentUser = Annotated[User, Depends(get_current_user)]
MAX_CODE_ATTEMPTS = 5
FRIEND_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"


async def _new_friend_code(db: AsyncSession) -> str:
    while True:
        code = "".join(secrets.choice(FRIEND_CODE_ALPHABET) for _ in range(6))
        if await db.scalar(select(User.id).where(User.friend_code == code)) is None:
            return code


def _new_code() -> str:
    return f"{secrets.randbelow(1_000_000):06d}"


def _code_expiry(minutes: int | None = None) -> datetime:
    return datetime.now(UTC) + timedelta(
        minutes=minutes or settings.VERIFICATION_CODE_EXPIRE_MINUTES
    )


def _expired(value: datetime | None) -> bool:
    if value is None:
        return True
    if value.tzinfo is None:
        value = value.replace(tzinfo=UTC)
    return value <= datetime.now(UTC)


@router.post("/register", status_code=status.HTTP_202_ACCEPTED)
async def register(payload: UserRegister, db: DbSession) -> dict[str, str]:
    email = str(payload.email).lower()
    existing = await db.scalar(select(User).where(User.email == email))
    if existing:
        raise HTTPException(status_code=409, detail="Konto z tym adresem e-mail już istnieje")

    code = _new_code()
    user = User(
        first_name=payload.first_name.strip(),
        last_name=payload.last_name.strip(),
        email=email,
        friend_code=await _new_friend_code(db),
        password_hash=hash_secret(payload.password),
        is_active=False,
        verification_code_hash=hash_secret(code),
        verification_code_expires_at=_code_expiry(),
        verification_attempts=0,
        notify_on_events=payload.notify_on_events,
    )
    db.add(user)
    await db.commit()
    try:
        await send_auth_code(email, code, "weryfikacja rejestracji")
    except Exception:
        await db.delete(user)
        await db.commit()
        raise HTTPException(status_code=503, detail="Nie udało się wysłać kodu e-mail") from None
    return {"message": "Konto utworzone. Wpisz kod wysłany na podany adres e-mail."}


@router.post("/verify", response_model=TokenResponse)
async def verify_account(payload: UserVerify, db: DbSession) -> TokenResponse:
    email = str(payload.email).lower()
    user = await db.scalar(select(User).where(User.email == email))
    if user is None or user.is_active:
        raise HTTPException(status_code=400, detail="Kod jest nieprawidłowy lub wygasł")
    if user.verification_attempts >= MAX_CODE_ATTEMPTS:
        raise HTTPException(status_code=429, detail="Przekroczono limit prób. Wyślij nowy kod.")
    if _expired(user.verification_code_expires_at) or not verify_secret(
        payload.code, user.verification_code_hash
    ):
        user.verification_attempts += 1
        await db.commit()
        raise HTTPException(status_code=400, detail="Kod jest nieprawidłowy lub wygasł")
    user.is_active = True
    user.verification_code_hash = None
    user.verification_code_expires_at = None
    user.verification_attempts = 0
    await db.commit()
    await db.refresh(user)
    return TokenResponse(access_token=create_access_token(user.id), user=user)


@router.post("/resend-code", status_code=status.HTTP_202_ACCEPTED)
async def resend_code(payload: UserResendCode, db: DbSession) -> dict[str, str]:
    email = str(payload.email).lower()
    user = await db.scalar(select(User).where(User.email == email))
    # Jednolita odpowiedź ogranicza ujawnianie, czy adres ma konto.
    if user is None or user.is_active:
        return {"message": "Jeśli konto wymaga weryfikacji, wysłaliśmy nowy kod."}
    code = _new_code()
    user.verification_code_hash = hash_secret(code)
    user.verification_code_expires_at = _code_expiry()
    user.verification_attempts = 0
    await db.commit()
    try:
        await send_auth_code(email, code, "weryfikacja rejestracji")
    except Exception:
        raise HTTPException(status_code=503, detail="Nie udało się wysłać kodu e-mail") from None
    return {"message": "Jeśli konto wymaga weryfikacji, wysłaliśmy nowy kod."}


@router.post("/login", response_model=TokenResponse)
async def login(payload: UserLogin, db: DbSession) -> TokenResponse:
    email = str(payload.email).lower()
    user = await db.scalar(select(User).where(User.email == email))
    if user is None or not verify_secret(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Nieprawidłowy e-mail lub hasło")
    if not user.is_active:
        raise HTTPException(status_code=403, detail="Najpierw potwierdź adres e-mail")
    return TokenResponse(access_token=create_access_token(user.id), user=user)


@router.post("/forgot-password", status_code=status.HTTP_202_ACCEPTED)
async def forgot_password(payload: ForgotPassword, db: DbSession) -> dict[str, str]:
    email = str(payload.email).lower()
    user = await db.scalar(select(User).where(User.email == email))
    if user is not None and user.is_active:
        code = _new_code()
        user.reset_password_code_hash = hash_secret(code)
        user.reset_password_expires_at = _code_expiry(settings.RESET_CODE_EXPIRE_MINUTES)
        user.reset_password_attempts = 0
        await db.commit()
        try:
            await send_auth_code(email, code, "reset hasła")
        except Exception:
            raise HTTPException(
                status_code=503, detail="Nie udało się wysłać kodu e-mail"
            ) from None
    return {"message": "Jeśli konto istnieje, wysłaliśmy instrukcję resetu hasła."}


@router.post("/reset-password")
async def reset_password(payload: ResetPassword, db: DbSession) -> dict[str, str]:
    email = str(payload.email).lower()
    user = await db.scalar(select(User).where(User.email == email))
    if user is None or not user.is_active:
        raise HTTPException(status_code=400, detail="Kod jest nieprawidłowy lub wygasł")
    if user.reset_password_attempts >= MAX_CODE_ATTEMPTS:
        raise HTTPException(status_code=429, detail="Przekroczono limit prób. Poproś o nowy kod.")
    if _expired(user.reset_password_expires_at) or not verify_secret(
        payload.code, user.reset_password_code_hash
    ):
        user.reset_password_attempts += 1
        await db.commit()
        raise HTTPException(status_code=400, detail="Kod jest nieprawidłowy lub wygasł")
    user.password_hash = hash_secret(payload.new_password)
    user.reset_password_code_hash = None
    user.reset_password_expires_at = None
    user.reset_password_attempts = 0
    await db.commit()
    return {"message": "Hasło zostało zmienione."}


@router.get("/me", response_model=UserResponse)
async def get_me(current_user: CurrentUser) -> User:
    return current_user


@router.patch("/me", response_model=UserResponse)
async def update_me(payload: UserUpdate, current_user: CurrentUser, db: DbSession) -> User:
    if payload.friend_code is not None:
        requested_code = payload.friend_code.upper()
        existing = await db.scalar(
            select(User.id).where(User.friend_code == requested_code, User.id != current_user.id)
        )
        if existing is not None:
            raise HTTPException(status_code=409, detail="Ten identyfikator jest już zajęty")
        current_user.friend_code = requested_code
    for field, value in payload.model_dump(exclude_unset=True).items():
        if field == "friend_code":
            continue
        setattr(current_user, field, value.strip() if isinstance(value, str) else value)
    await db.commit()
    await db.refresh(current_user)
    return current_user


@router.delete("/me", status_code=status.HTTP_204_NO_CONTENT)
async def delete_me(
    payload: UserDelete,
    current_user: CurrentUser,
    db: DbSession,
) -> Response:
    if not verify_secret(payload.password, current_user.password_hash):
        raise HTTPException(status_code=400, detail="Podane hasło jest nieprawidłowe")
    await db.delete(current_user)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
