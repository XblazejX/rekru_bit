from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, Index, Integer, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.models.event import Event
    from app.models.user import User


class AvailabilitySlot(Base):
    __tablename__ = "availability_slots"
    __table_args__ = (
        UniqueConstraint(
            "event_id", "user_id", "slot_start", name="uq_event_user_slot_start"
        ),
        Index("ix_availability_event_slot", "event_id", "slot_start"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    event_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("events.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    slot_start: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    # Relacje
    event: Mapped["Event"] = relationship("Event", back_populates="availability_slots")
    user: Mapped["User"] = relationship("User", back_populates="availability_slots")
