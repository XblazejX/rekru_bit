from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status

from sqlalchemy import delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import get_current_user
from app.db.session import get_db
from app.models.availability import AvailabilitySlot
from app.models.event import Event
from app.models.message import EventMessage
from app.models.participant import EventParticipant
from app.models.user import User
from app.schemas.availability import (
    AvailabilitySetRequest,
    AvailabilitySlotResponse,
    EventAggregationResponse,
    SlotAggregateItem,
)
from app.schemas.event import EventCreate, EventListItem, EventResponse, EventUpdate

router = APIRouter(prefix="/events", tags=["Events"])
DbSession = Annotated[AsyncSession, Depends(get_db)]
CurrentUser = Annotated[User, Depends(get_current_user)]


async def _event_item(db: AsyncSession, event: Event, user_id: int) -> EventListItem:
    participants_count = await db.scalar(
        select(func.count(EventParticipant.id)).where(EventParticipant.event_id == event.id)
    )
    messages_count = await db.scalar(
        select(func.count(EventMessage.id)).where(EventMessage.event_id == event.id)
    )
    return EventListItem(
        **EventResponse.model_validate(event).model_dump(),
        participants_count=participants_count or 0,
        messages_count=messages_count or 0,
        is_owner=event.owner_id == user_id,
        is_member=bool(
            user_id
            and await db.scalar(
                select(EventParticipant.id).where(
                    EventParticipant.event_id == event.id,
                    EventParticipant.user_id == user_id,
                )
            )
        ),
    )


@router.get("", response_model=list[EventListItem])
async def list_events(current_user: CurrentUser, db: DbSession) -> list[EventListItem]:
    events = await db.scalars(
        select(Event)
        .outerjoin(EventParticipant, EventParticipant.event_id == Event.id)
        .where(or_(Event.owner_id == current_user.id, EventParticipant.user_id == current_user.id))
        .distinct()
        .order_by(Event.created_at.desc())
    )
    return [await _event_item(db, event, current_user.id) for event in events]


@router.post("", response_model=EventListItem, status_code=status.HTTP_201_CREATED)
async def create_event(
    payload: EventCreate, current_user: CurrentUser, db: DbSession
) -> EventListItem:
    event = Event(**payload.model_dump(), owner_id=current_user.id)
    db.add(event)
    await db.flush()
    db.add(EventParticipant(event_id=event.id, user_id=current_user.id))
    await db.commit()
    await db.refresh(event)
    return await _event_item(db, event, current_user.id)


@router.get("/{public_id}", response_model=EventListItem)
async def get_public_event(public_id: str, db: DbSession) -> EventListItem:
    event = await db.scalar(select(Event).where(Event.public_id == public_id))
    if event is None:
        raise HTTPException(status_code=404, detail="Nie znaleziono wydarzenia")
    return await _event_item(db, event, 0)


@router.get("/{public_id}/membership")
async def get_event_membership(
    public_id: str, current_user: CurrentUser, db: DbSession
) -> dict[str, bool]:
    event_id = await db.scalar(select(Event.id).where(Event.public_id == public_id))
    if event_id is None:
        raise HTTPException(status_code=404, detail="Nie znaleziono wydarzenia")
    member_id = await db.scalar(
        select(EventParticipant.id).where(
            EventParticipant.event_id == event_id,
            EventParticipant.user_id == current_user.id,
        )
    )
    return {"is_member": member_id is not None}


async def _require_event_member(event: Event, user: User, db: AsyncSession) -> None:
    member_id = await db.scalar(
        select(EventParticipant.id).where(
            EventParticipant.event_id == event.id,
            EventParticipant.user_id == user.id,
        )
    )
    if member_id is None:
        raise HTTPException(status_code=403, detail="Najpierw dołącz do tego spotkania")


@router.get("/{public_id}/availability", response_model=EventAggregationResponse)
async def get_availability_aggregation(
    public_id: str, db: DbSession
) -> EventAggregationResponse:
    event = await db.scalar(select(Event).where(Event.public_id == public_id))
    if event is None:
        raise HTTPException(status_code=404, detail="Nie znaleziono spotkania")

    total_participants = await db.scalar(
        select(func.count(EventParticipant.id)).where(EventParticipant.event_id == event.id)
    )
    rows = await db.execute(
        select(AvailabilitySlot.slot_start, func.count(func.distinct(AvailabilitySlot.user_id)))
        .where(AvailabilitySlot.event_id == event.id)
        .group_by(AvailabilitySlot.slot_start)
        .order_by(AvailabilitySlot.slot_start)
    )
    total = total_participants or 0
    slots = [
        SlotAggregateItem(
            slot_start=slot_start,
            available_count=count,
            available_percentage=round(count * 100 / total, 1) if total else 0,
        )
        for slot_start, count in rows
    ]
    return EventAggregationResponse(
        public_id=event.public_id,
        total_participants=total,
        slots=slots,
    )


@router.get("/{public_id}/availability/me", response_model=list[AvailabilitySlotResponse])
async def get_my_availability(
    public_id: str, current_user: CurrentUser, db: DbSession
) -> list[AvailabilitySlot]:
    event = await db.scalar(select(Event).where(Event.public_id == public_id))
    if event is None:
        raise HTTPException(status_code=404, detail="Nie znaleziono spotkania")
    await _require_event_member(event, current_user, db)
    slots = await db.scalars(
        select(AvailabilitySlot)
        .where(
            AvailabilitySlot.event_id == event.id,
            AvailabilitySlot.user_id == current_user.id,
        )
        .order_by(AvailabilitySlot.slot_start)
    )
    return list(slots)


@router.put("/{public_id}/availability/me", response_model=list[AvailabilitySlotResponse])
async def save_my_availability(
    public_id: str,
    payload: AvailabilitySetRequest,
    current_user: CurrentUser,
    db: DbSession,
) -> list[AvailabilitySlot]:
    event = await db.scalar(select(Event).where(Event.public_id == public_id))
    if event is None:
        raise HTTPException(status_code=404, detail="Nie znaleziono spotkania")
    await _require_event_member(event, current_user, db)

    normalized: set[datetime] = set()
    for slot_start in payload.slot_starts:
        if slot_start.tzinfo is None or slot_start.utcoffset() is None:
            raise HTTPException(status_code=422, detail="Godzina musi zawierać strefę czasową")
        if slot_start.minute not in (0, 30) or slot_start.second or slot_start.microsecond:
            raise HTTPException(status_code=422, detail="Dostępność wybiera się w krokach co 30 minut")
        normalized.add(slot_start.astimezone(UTC))

    await db.execute(
        delete(AvailabilitySlot).where(
            AvailabilitySlot.event_id == event.id,
            AvailabilitySlot.user_id == current_user.id,
        )
    )
    db.add_all(
        AvailabilitySlot(event_id=event.id, user_id=current_user.id, slot_start=slot_start)
        for slot_start in sorted(normalized)
    )
    await db.commit()
    saved = await db.scalars(
        select(AvailabilitySlot)
        .where(
            AvailabilitySlot.event_id == event.id,
            AvailabilitySlot.user_id == current_user.id,
        )
        .order_by(AvailabilitySlot.slot_start)
    )
    return list(saved)


@router.post("/{public_id}/join", response_model=EventListItem)
async def join_event(
    public_id: str, current_user: CurrentUser, db: DbSession
) -> EventListItem:
    event = await db.scalar(select(Event).where(Event.public_id == public_id))
    if event is None:
        raise HTTPException(status_code=404, detail="Nie znaleziono wydarzenia")
    participant = await db.scalar(
        select(EventParticipant).where(
            EventParticipant.event_id == event.id,
            EventParticipant.user_id == current_user.id,
        )
    )
    if participant is None:
        db.add(EventParticipant(event_id=event.id, user_id=current_user.id))
        await db.commit()
    return await _event_item(db, event, current_user.id)


@router.patch("/{public_id}", response_model=EventListItem)
async def update_event(
    public_id: str,
    payload: EventUpdate,
    current_user: CurrentUser,
    db: DbSession,
) -> EventListItem:
    event = await db.scalar(select(Event).where(Event.public_id == public_id))
    if event is None:
        raise HTTPException(status_code=404, detail="Nie znaleziono wydarzenia")
    if event.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Tylko twórca może edytować wydarzenie")

    changes = payload.model_dump(exclude_unset=True)
    final_start = changes.get("final_slot_start", event.final_slot_start)
    final_end = changes.get("final_slot_end", event.final_slot_end)
    if (final_start is None) != (final_end is None):
        raise HTTPException(status_code=422, detail="Podaj początek i koniec wybranego terminu")
    if final_start is not None and final_end <= final_start:
        raise HTTPException(status_code=422, detail="Koniec terminu musi być późniejszy niż początek")

    for field, value in changes.items():
        setattr(event, field, value)
    await db.commit()
    await db.refresh(event)
    return await _event_item(db, event, current_user.id)


@router.delete("/{public_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_event(public_id: str, current_user: CurrentUser, db: DbSession) -> None:
    event = await db.scalar(select(Event).where(Event.public_id == public_id))
    if event is None:
        raise HTTPException(status_code=404, detail="Nie znaleziono wydarzenia")
    if event.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Tylko twórca może usunąć wydarzenie")
    await db.delete(event)
    await db.commit()
