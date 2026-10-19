import secrets
from datetime import date, datetime
from typing import TYPE_CHECKING

from sqlalchemy import Date, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin

if TYPE_CHECKING:
    from app.models.availability import AvailabilitySlot
    from app.models.message import EventMessage
    from app.models.participant import EventParticipant
    from app.models.user import User


def generate_public_id() -> str:
    """Generowanie bezpiecznego, unikalnego identyfikatora URL (12 znaków)."""
    return secrets.token_urlsafe(9)


class Event(Base, TimestampMixin):
    __tablename__ = "events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    title: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    public_id: Mapped[str] = mapped_column(
        String(32), unique=True, index=True, default=generate_public_id, nullable=False
    )
    owner_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )

    # Zakres dat wydarzenia i interwał siatki
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    end_date: Mapped[date] = mapped_column(Date, nullable=False)
    slot_minutes: Mapped[int] = mapped_column(Integer, default=30, nullable=False)

    # Finalny wybrany termin spotkania (ustalany przez twórcę)
    final_slot_start: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    final_slot_end: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # Relacje
    owner: Mapped["User"] = relationship("User", back_populates="owned_events")
    participants: Mapped[list["EventParticipant"]] = relationship(
        "EventParticipant", back_populates="event", cascade="all, delete-orphan"
    )
    availability_slots: Mapped[list["AvailabilitySlot"]] = relationship(
        "AvailabilitySlot", back_populates="event", cascade="all, delete-orphan"
    )
    messages: Mapped[list["EventMessage"]] = relationship(
        "EventMessage", back_populates="event", cascade="all, delete-orphan"
    )
