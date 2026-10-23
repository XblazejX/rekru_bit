from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class FriendRequestCreate(BaseModel):
    friend_code: str = Field(min_length=6, max_length=7, pattern="^#?[A-Za-z0-9]{6}$")


class FriendSummary(BaseModel):
    id: int
    first_name: str
    last_name: str


class NotificationItem(BaseModel):
    type: Literal["friend_request", "event_invitation"]
    id: int
    created_at: datetime
    sender_name: str
    sender_user_id: int
    event_public_id: str | None = None
    event_title: str | None = None


class FriendAvailabilitySet(BaseModel):
    start: datetime
    end: datetime
    slot_starts: list[datetime] = Field(default_factory=list, max_length=336)
    slot_notes: dict[datetime, str] = Field(default_factory=dict, max_length=336)


class FriendAvailabilitySlotResponse(BaseModel):
    user_id: int
    first_name: str
    last_name: str
    slot_start: datetime
    note: str = ""


class OwnFriendAvailabilitySlotResponse(BaseModel):
    slot_start: datetime
    note: str = ""


class EventInviteCreate(BaseModel):
    friend_id: int


class InvitationResponse(BaseModel):
    id: int
    event_id: int
    status: Literal["pending", "accepted", "rejected"]
