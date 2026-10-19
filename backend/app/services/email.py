import logging
from email.message import EmailMessage

import aiosmtplib

from app.core.config import settings

logger = logging.getLogger(__name__)


async def send_auth_code(recipient: str, code: str, purpose: str) -> None:
    """Send a one-time code through SMTP, or log it in development mock mode."""
    if settings.EMAIL_MODE.lower() == "mock":
        if settings.ENVIRONMENT.lower() in {"prod", "production"}:
            raise RuntimeError("Tryb mock poczty nie może być używany na produkcji")
        logger.info("[EMAIL MOCK] recipient=%s purpose=%s code=%s", recipient, purpose, code)
        return
    if settings.EMAIL_MODE.lower() != "smtp":
        raise RuntimeError("EMAIL_MODE musi mieć wartość 'mock' albo 'smtp'")
    if not settings.SMTP_HOST or not settings.SMTP_USER or not settings.SMTP_PASSWORD:
        raise RuntimeError("Brakuje konfiguracji SMTP_HOST, SMTP_USER lub SMTP_PASSWORD")

    message = EmailMessage()
    message["From"] = settings.SMTP_FROM
    message["To"] = recipient
    message["Subject"] = "Kod Bit2Meet"
    ttl = (
        settings.RESET_CODE_EXPIRE_MINUTES
        if "reset" in purpose.lower()
        else settings.VERIFICATION_CODE_EXPIRE_MINUTES
    )
    message.set_content(
        f"Twój kod do Bit2Meet ({purpose.lower()}): {code}\n\nKod wygaśnie za {ttl} minut."
    )
    await aiosmtplib.send(
        message,
        hostname=settings.SMTP_HOST,
        port=settings.SMTP_PORT,
        username=settings.SMTP_USER,
        password=settings.SMTP_PASSWORD,
        start_tls=settings.SMTP_TLS and settings.SMTP_PORT != 465,
        use_tls=settings.SMTP_PORT == 465,
    )
