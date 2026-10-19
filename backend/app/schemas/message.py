from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class MessageCreate(BaseModel):
    body: str = Field(..., min_length=1, max_length=2000, description="Treść wiadomości (1-2000 znaków)")


class MessageResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    event_id: int
    user_id: int
    user_name: str
    body: str
    created_at: datetime


class MessageListResponse(BaseModel):
    total: int
    messages: list[MessageResponse]
