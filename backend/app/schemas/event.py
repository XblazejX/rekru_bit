from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class EventBase(BaseModel):
    title: str = Field(..., min_length=3, max_length=100)
    description: str | None = Field(None, max_length=1000)


class EventCreate(EventBase):
    pass


class EventUpdate(BaseModel):
    title: str | None = Field(None, min_length=3, max_length=100)
    description: str | None = Field(None, max_length=1000)
    final_slot_start: datetime | None = None
    final_slot_end: datetime | None = None


class ParticipantInfo(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    user_id: int
    first_name: str
    last_name: str
    joined_at: datetime


class EventResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    description: str | None
    public_id: str
    final_slot_start: datetime | None
    final_slot_end: datetime | None
    created_at: datetime


class EventListItem(EventResponse):
    participants_count: int = 0
    messages_count: int = 0
    is_owner: bool = False
    is_member: bool = False
