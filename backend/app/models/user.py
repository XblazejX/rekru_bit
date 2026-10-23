import secrets
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin

if TYPE_CHECKING:
    from app.models.availability import AvailabilitySlot
    from app.models.event import Event
    from app.models.message import EventMessage
    from app.models.participant import EventParticipant


class User(Base, TimestampMixin):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    first_name: Mapped[str] = mapped_column(String(50), nullable=False)
    last_name: Mapped[str] = mapped_column(String(50), nullable=False)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    friend_code: Mapped[str] = mapped_column(
        String(6), default=lambda: secrets.token_hex(3).upper(), unique=True, index=True, nullable=False
    )
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)

    # Status konta i weryfikacja kodem e-mail
    is_active: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    verification_code_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    verification_code_expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    verification_attempts: Mapped[int] = mapped_column(
        Integer, default=0, server_default="0", nullable=False
    )

    # Reset hasła
    reset_password_code_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    reset_password_expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    reset_password_attempts: Mapped[int] = mapped_column(
        Integer, default=0, server_default="0", nullable=False
    )

    # Preferencje użytkownika
    notify_on_events: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    email_on_friend_requests: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="false", nullable=False
    )
    theme: Mapped[str] = mapped_column(String(20), default="dark", nullable=False)

    # Relacje
    owned_events: Mapped[list["Event"]] = relationship(
        "Event", back_populates="owner", cascade="all, delete-orphan"
    )
    participations: Mapped[list["EventParticipant"]] = relationship(
        "EventParticipant", back_populates="user", cascade="all, delete-orphan"
    )
    availability_slots: Mapped[list["AvailabilitySlot"]] = relationship(
        "AvailabilitySlot", back_populates="user", cascade="all, delete-orphan"
    )
    messages: Mapped[list["EventMessage"]] = relationship(
        "EventMessage", back_populates="user", cascade="all, delete-orphan"
    )

    @property
    def full_name(self) -> str:
        return f"{self.first_name} {self.last_name}".strip()
