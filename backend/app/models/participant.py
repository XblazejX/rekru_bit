from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, Integer, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, utc_now

if TYPE_CHECKING:
    from app.models.event import Event
    from app.models.user import User


class EventParticipant(Base):
    __tablename__ = "event_participants"
    __table_args__ = (
        UniqueConstraint("event_id", "user_id", name="uq_event_participant"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    event_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("events.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    joined_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, nullable=False
    )
    last_read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Relacje
    event: Mapped["Event"] = relationship("Event", back_populates="participants")
    user: Mapped["User"] = relationship("User", back_populates="participations")
