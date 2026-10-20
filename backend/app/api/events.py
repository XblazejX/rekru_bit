from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import get_current_user
from app.db.session import get_db
from app.models.event import Event
from app.models.message import EventMessage
from app.models.participant import EventParticipant
from app.models.user import User
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
