from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field, model_validator


class EventBase(BaseModel):
    title: str = Field(..., min_length=3, max_length=100)
    description: str | None = Field(None, max_length=1000)
    start_date: date
    end_date: date
    slot_minutes: int = Field(30, ge=15, le=60)

    @model_validator(mode="after")
    def validate_dates(self) -> "EventBase":
        if self.end_date < self.start_date:
            raise ValueError("Data zakończenia (end_date) nie może być wcześniejsza niż data rozpoczęcia (start_date)")
        return self


class EventCreate(EventBase):
    pass


class EventUpdate(BaseModel):
    title: str | None = Field(None, min_length=3, max_length=100)
    description: str | None = Field(None, max_length=1000)
    start_date: date | None = None
    end_date: date | None = None
    slot_minutes: int | None = Field(None, ge=15, le=60)
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
    owner_id: int
    start_date: date
    end_date: date
    slot_minutes: int
    final_slot_start: datetime | None
    final_slot_end: datetime | None
    created_at: datetime


class EventListItem(EventResponse):
    participants_count: int = 0
    messages_count: int = 0
    is_owner: bool = False
