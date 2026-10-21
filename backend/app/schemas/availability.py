from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class AvailabilitySetRequest(BaseModel):
    """Zestaw slotów wysyłany przez użytkownika (zastępuje lub aktualizuje jego dostępność)."""
    slot_starts: list[datetime] = Field(
        ...,
        max_length=5000,
        description="Początki 30-minutowych pól dostępności w formacie ISO 8601",
    )
    slot_notes: dict[str, str] = Field(default_factory=dict, max_length=5000)


class AvailabilitySlotResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    event_id: int
    user_id: int
    slot_start: datetime
    note: str


class AvailabilityNoteResponse(BaseModel):
    slot_start: datetime
    user_id: int
    user_name: str
    note: str


class SlotAggregateItem(BaseModel):
    slot_start: datetime
    available_count: int
    available_percentage: float
    user_ids: list[int] = Field(default_factory=list)


class EventAggregationResponse(BaseModel):
    public_id: str
    total_participants: int
    slots: list[SlotAggregateItem]


class SlotSuggestion(BaseModel):
    start_time: datetime
    end_time: datetime
    duration_minutes: int
    available_count: int
    available_percentage: float
