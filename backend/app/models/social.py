from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin


class Friendship(Base, TimestampMixin):
    __tablename__ = "friendships"
    __table_args__ = (
        UniqueConstraint("user_low_id", "user_high_id", name="uq_friendship_pair"),
        CheckConstraint("user_low_id < user_high_id", name="ck_friendship_ordered_users"),
        CheckConstraint(
            "status IN ('pending', 'accepted', 'rejected')", name="ck_friendship_status"
        ),
        Index("ix_friendships_low", "user_low_id"),
        Index("ix_friendships_high_status", "user_high_id", "status"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_low_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    user_high_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    requested_by_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending")


class EventInvitation(Base, TimestampMixin):
    __tablename__ = "event_invitations"
    __table_args__ = (
        UniqueConstraint("event_id", "invited_user_id", name="uq_event_invitation_recipient"),
        CheckConstraint(
            "status IN ('pending', 'accepted', 'rejected')", name="ck_event_invitation_status"
        ),
        Index("ix_event_invitations_recipient_status", "invited_user_id", "status"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    event_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("events.id", ondelete="CASCADE"), nullable=False
    )
    invited_by_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    invited_user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending")


class FriendAvailabilitySlot(Base):
    __tablename__ = "friend_availability_slots"
    __table_args__ = (
        UniqueConstraint("user_id", "slot_start", name="uq_friend_availability_user_slot"),
        Index("ix_friend_availability_user_slot", "user_id", "slot_start"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    slot_start: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    note: Mapped[str] = mapped_column(String(500), default="", server_default="", nullable=False)
