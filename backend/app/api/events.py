from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import get_current_user
from app.db.session import get_db
from app.models.availability import AvailabilitySlot
from app.models.event import Event
from app.models.message import EventMessage
from app.models.participant import EventParticipant
from app.models.social import EventInvitation, Friendship
from app.models.user import User
from app.schemas.availability import (
    AvailabilityNoteResponse,
    AvailabilityParticipantResponse,
    AvailabilitySetRequest,
    AvailabilitySlotResponse,
    EventAggregationResponse,
    SlotAggregateItem,
)
from app.schemas.event import EventCreate, EventListItem, EventResponse, EventUpdate
from app.schemas.message import MessageCreate, MessageListResponse, MessageResponse
from app.schemas.social import EventInviteCreate

router = APIRouter(prefix="/events", tags=["Events"])
DbSession = Annotated[AsyncSession, Depends(get_db)]
CurrentUser = Annotated[User, Depends(get_current_user)]


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None or value.utcoffset() is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


async def _event_item(db: AsyncSession, event: Event, user_id: int) -> EventListItem:
    participants_count = await db.scalar(
        select(func.count(EventParticipant.id)).where(EventParticipant.event_id == event.id)
    )
    messages_count = await db.scalar(
        select(func.count(EventMessage.id)).where(EventMessage.event_id == event.id)
    )
    participant = await db.scalar(
        select(EventParticipant).where(
            EventParticipant.event_id == event.id,
            EventParticipant.user_id == user_id,
        )
    ) if user_id else None
    unread_count = 0
    if participant is not None:
        unread_query = select(func.count(EventMessage.id)).where(
            EventMessage.event_id == event.id,
            EventMessage.user_id != user_id,
        )
        if participant.last_read_at is not None:
            unread_query = unread_query.where(EventMessage.created_at > participant.last_read_at)
        unread_count = await db.scalar(unread_query) or 0
    return EventListItem(
        **EventResponse.model_validate(event).model_dump(),
        participants_count=participants_count or 0,
        messages_count=messages_count or 0,
        unread_count=unread_count,
        is_owner=event.owner_id == user_id,
        is_member=participant is not None,
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
    event = await db.scalar(select(Event).where(Event.public_id == public_id))
    if event is None:
        raise HTTPException(status_code=404, detail="Nie znaleziono wydarzenia")
    member_id = await db.scalar(
        select(EventParticipant.id).where(
            EventParticipant.event_id == event.id,
            EventParticipant.user_id == current_user.id,
        )
    )
    return {"is_member": member_id is not None, "is_owner": event.owner_id == current_user.id}


@router.post("/{public_id}/invitations", status_code=status.HTTP_201_CREATED)
async def invite_friend_to_event(
    public_id: str,
    payload: EventInviteCreate,
    current_user: CurrentUser,
    db: DbSession,
) -> dict[str, str]:
    event = await db.scalar(select(Event).where(Event.public_id == public_id))
    if event is None:
        raise HTTPException(status_code=404, detail="Nie znaleziono spotkania")
    await _require_event_member(event, current_user, db)
    if payload.friend_id == current_user.id:
        raise HTTPException(status_code=400, detail="Nie możesz zaprosić siebie")
    low_id, high_id = sorted((current_user.id, payload.friend_id))
    friendship = await db.scalar(
        select(Friendship).where(
            Friendship.user_low_id == low_id,
            Friendship.user_high_id == high_id,
            Friendship.status == "accepted",
        )
    )
    if friendship is None:
        raise HTTPException(status_code=403, detail="Do wydarzenia możesz zaprosić tylko znajomego")
    if await db.scalar(
        select(EventParticipant.id).where(
            EventParticipant.event_id == event.id,
            EventParticipant.user_id == payload.friend_id,
        )
    ):
        raise HTTPException(status_code=409, detail="Ta osoba jest już uczestnikiem spotkania")

    invitation = await db.scalar(
        select(EventInvitation).where(
            EventInvitation.event_id == event.id,
            EventInvitation.invited_user_id == payload.friend_id,
        )
    )
    if invitation and invitation.status == "pending":
        raise HTTPException(status_code=409, detail="Zaproszenie do tego spotkania już oczekuje")
    if invitation:
        invitation.invited_by_id = current_user.id
        invitation.status = "pending"
        invitation.created_at = datetime.now(UTC)
    else:
        invitation = EventInvitation(
            event_id=event.id,
            invited_by_id=current_user.id,
            invited_user_id=payload.friend_id,
            status="pending",
        )
        db.add(invitation)
    await db.commit()
    return {"message": "Wysłano zaproszenie do spotkania."}


@router.post("/invitations/{invitation_id}/accept", response_model=EventListItem)
async def accept_event_invitation(
    invitation_id: int, current_user: CurrentUser, db: DbSession
) -> EventListItem:
    invitation = await db.scalar(
        select(EventInvitation).where(
            EventInvitation.id == invitation_id,
            EventInvitation.invited_user_id == current_user.id,
            EventInvitation.status == "pending",
        )
    )
    if invitation is None:
        raise HTTPException(status_code=404, detail="Nie znaleziono zaproszenia do spotkania")
    event = await db.get(Event, invitation.event_id)
    if event is None:
        raise HTTPException(status_code=404, detail="Spotkanie już nie istnieje")
    participant_id = await db.scalar(
        select(EventParticipant.id).where(
            EventParticipant.event_id == event.id,
            EventParticipant.user_id == current_user.id,
        )
    )
    if participant_id is None:
        db.add(EventParticipant(event_id=event.id, user_id=current_user.id))
    invitation.status = "accepted"
    await db.commit()
    return await _event_item(db, event, current_user.id)


@router.post("/invitations/{invitation_id}/reject")
async def reject_event_invitation(
    invitation_id: int, current_user: CurrentUser, db: DbSession
) -> dict[str, str]:
    invitation = await db.scalar(
        select(EventInvitation).where(
            EventInvitation.id == invitation_id,
            EventInvitation.invited_user_id == current_user.id,
            EventInvitation.status == "pending",
        )
    )
    if invitation is None:
        raise HTTPException(status_code=404, detail="Nie znaleziono zaproszenia do spotkania")
    invitation.status = "rejected"
    await db.commit()
    return {"message": "Odrzucono zaproszenie do spotkania."}


async def _require_event_member(event: Event, user: User, db: AsyncSession) -> None:
    member_id = await db.scalar(
        select(EventParticipant.id).where(
            EventParticipant.event_id == event.id,
            EventParticipant.user_id == user.id,
        )
    )
    if member_id is None:
        raise HTTPException(status_code=403, detail="Najpierw dołącz do tego spotkania")


@router.get("/{public_id}/messages", response_model=MessageListResponse)
async def list_event_messages(
    public_id: str, current_user: CurrentUser, db: DbSession
) -> MessageListResponse:
    event = await db.scalar(select(Event).where(Event.public_id == public_id))
    if event is None:
        raise HTTPException(status_code=404, detail="Nie znaleziono spotkania")
    await _require_event_member(event, current_user, db)

    total = await db.scalar(
        select(func.count(EventMessage.id)).where(EventMessage.event_id == event.id)
    )
    rows = await db.execute(
        select(EventMessage, User.first_name, User.last_name)
        .join(User, User.id == EventMessage.user_id)
        .where(EventMessage.event_id == event.id)
        .order_by(EventMessage.created_at.desc(), EventMessage.id.desc())
        .limit(100)
    )
    messages = [
        MessageResponse(
            id=message.id,
            event_id=message.event_id,
            user_id=message.user_id,
            user_name=f"{first_name} {last_name}",
            body=message.body,
            created_at=message.created_at,
        )
        for message, first_name, last_name in reversed(rows.all())
    ]
    participant = await db.scalar(
        select(EventParticipant).where(
            EventParticipant.event_id == event.id,
            EventParticipant.user_id == current_user.id,
        )
    )
    if participant is not None:
        participant.last_read_at = max(
            (message.created_at for message in messages), default=datetime.now(UTC)
        )
        await db.commit()
    return MessageListResponse(total=total or 0, messages=messages)


@router.post(
    "/{public_id}/messages",
    response_model=MessageResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_event_message(
    public_id: str,
    payload: MessageCreate,
    current_user: CurrentUser,
    db: DbSession,
) -> MessageResponse:
    event = await db.scalar(select(Event).where(Event.public_id == public_id))
    if event is None:
        raise HTTPException(status_code=404, detail="Nie znaleziono spotkania")
    await _require_event_member(event, current_user, db)
    body = payload.body.strip()
    if not body:
        raise HTTPException(status_code=422, detail="Wiadomość nie może być pusta")

    message = EventMessage(event_id=event.id, user_id=current_user.id, body=body)
    db.add(message)
    participant = await db.scalar(
        select(EventParticipant).where(
            EventParticipant.event_id == event.id,
            EventParticipant.user_id == current_user.id,
        )
    )
    if participant is not None:
        participant.last_read_at = datetime.now(UTC)
    await db.commit()
    await db.refresh(message)
    return MessageResponse(
        id=message.id,
        event_id=message.event_id,
        user_id=message.user_id,
        user_name=f"{current_user.first_name} {current_user.last_name}",
        body=message.body,
        created_at=message.created_at,
    )


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


@router.get("/{public_id}/availability/notes", response_model=list[AvailabilityNoteResponse])
async def get_availability_notes(
    public_id: str, current_user: CurrentUser, db: DbSession
) -> list[AvailabilityNoteResponse]:
    event = await db.scalar(select(Event).where(Event.public_id == public_id))
    if event is None:
        raise HTTPException(status_code=404, detail="Nie znaleziono spotkania")
    await _require_event_member(event, current_user, db)
    rows = await db.execute(
        select(AvailabilitySlot, User.first_name, User.last_name)
        .join(User, User.id == AvailabilitySlot.user_id)
        .where(AvailabilitySlot.event_id == event.id, AvailabilitySlot.note != "")
        .order_by(AvailabilitySlot.slot_start)
    )
    return [
        AvailabilityNoteResponse(
            slot_start=slot.slot_start,
            user_id=slot.user_id,
            user_name=f"{first_name} {last_name}",
            note=slot.note,
        )
        for slot, first_name, last_name in rows
    ]


@router.get(
    "/{public_id}/availability/participants",
    response_model=list[AvailabilityParticipantResponse],
)
async def get_availability_participants(
    public_id: str,
    current_user: CurrentUser,
    db: DbSession,
    start: Annotated[datetime, Query()],
    end: Annotated[datetime, Query()],
) -> list[AvailabilityParticipantResponse]:
    event = await db.scalar(select(Event).where(Event.public_id == public_id))
    if event is None:
        raise HTTPException(status_code=404, detail="Nie znaleziono spotkania")
    await _require_event_member(event, current_user, db)
    if (
        start.tzinfo is None
        or start.utcoffset() is None
        or end.tzinfo is None
        or end.utcoffset() is None
    ):
        raise HTTPException(status_code=422, detail="Zakres dat musi zawierać strefę czasową")
    start_utc, end_utc = start.astimezone(UTC), end.astimezone(UTC)
    if end_utc <= start_utc or end_utc - start_utc > timedelta(days=8):
        raise HTTPException(status_code=422, detail="Zakres kalendarza może obejmować najwyżej 8 dni")

    rows = await db.execute(
        select(AvailabilitySlot, User.first_name, User.last_name)
        .join(User, User.id == AvailabilitySlot.user_id)
        .where(
            AvailabilitySlot.event_id == event.id,
            AvailabilitySlot.slot_start >= start_utc,
            AvailabilitySlot.slot_start < end_utc,
        )
        .order_by(AvailabilitySlot.slot_start, AvailabilitySlot.user_id)
    )
    return [
        AvailabilityParticipantResponse(
            slot_start=_as_utc(slot.slot_start),
            user_id=slot.user_id,
            user_name=f"{first_name} {last_name}",
            note=slot.note,
        )
        for slot, first_name, last_name in rows
    ]


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

    normalized_notes: dict[datetime, str] = {}
    for raw_slot_start, raw_note in payload.slot_notes.items():
        try:
            note_start = datetime.fromisoformat(raw_slot_start.replace("Z", "+00:00"))
        except ValueError as error:
            raise HTTPException(status_code=422, detail="Nieprawidłowy termin notatki") from error
        if note_start.tzinfo is None or note_start.utcoffset() is None:
            raise HTTPException(status_code=422, detail="Termin notatki musi zawierać strefę czasową")
        note = raw_note.strip()
        if len(note) > 500:
            raise HTTPException(status_code=422, detail="Notatka może mieć najwyżej 500 znaków")
        normalized_notes[note_start.astimezone(UTC)] = note

    await db.execute(
        delete(AvailabilitySlot).where(
            AvailabilitySlot.event_id == event.id,
            AvailabilitySlot.user_id == current_user.id,
        )
    )
    db.add_all(
        AvailabilitySlot(
            event_id=event.id,
            user_id=current_user.id,
            slot_start=slot_start,
            note=normalized_notes.get(slot_start, ""),
        )
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


@router.post("/{public_id}/leave", status_code=status.HTTP_204_NO_CONTENT)
async def leave_event(public_id: str, current_user: CurrentUser, db: DbSession) -> None:
    event = await db.scalar(select(Event).where(Event.public_id == public_id))
    if event is None:
        raise HTTPException(status_code=404, detail="Nie znaleziono wydarzenia")
    if event.owner_id == current_user.id:
        raise HTTPException(status_code=400, detail="Twórca może usunąć wydarzenie, ale nie może go opuścić")
    participant = await db.scalar(
        select(EventParticipant).where(
            EventParticipant.event_id == event.id,
            EventParticipant.user_id == current_user.id,
        )
    )
    if participant is None:
        raise HTTPException(status_code=400, detail="Nie jesteś uczestnikiem tego spotkania")
    await db.execute(
        delete(AvailabilitySlot).where(
            AvailabilitySlot.event_id == event.id,
            AvailabilitySlot.user_id == current_user.id,
        )
    )
    await db.delete(participant)
    await db.commit()


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
