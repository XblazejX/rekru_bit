from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import delete, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import get_current_user
from app.db.session import get_db
from app.models.event import Event
from app.models.social import EventInvitation, FriendAvailabilitySlot, Friendship
from app.models.user import User
from app.schemas.social import (
    FriendAvailabilitySet,
    FriendAvailabilitySlotResponse,
    FriendRequestCreate,
    FriendSummary,
    NotificationItem,
    OwnFriendAvailabilitySlotResponse,
)

router = APIRouter(prefix="/social", tags=["Friends and notifications"])
DbSession = Annotated[AsyncSession, Depends(get_db)]
CurrentUser = Annotated[User, Depends(get_current_user)]


def _pair(first_id: int, second_id: int) -> tuple[int, int]:
    return min(first_id, second_id), max(first_id, second_id)


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None or value.utcoffset() is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


async def _get_friendship(db: AsyncSession, user_id: int, friend_id: int) -> Friendship | None:
    low_id, high_id = _pair(user_id, friend_id)
    return await db.scalar(
        select(Friendship).where(
            Friendship.user_low_id == low_id,
            Friendship.user_high_id == high_id,
        )
    )


@router.get("/friends", response_model=list[FriendSummary])
async def list_friends(current_user: CurrentUser, db: DbSession) -> list[User]:
    friendships = await db.scalars(
        select(Friendship).where(
            Friendship.status == "accepted",
            or_(
                Friendship.user_low_id == current_user.id,
                Friendship.user_high_id == current_user.id,
            ),
        )
    )
    friend_ids = [
        row.user_high_id if row.user_low_id == current_user.id else row.user_low_id
        for row in friendships
    ]
    if not friend_ids:
        return []
    friends = await db.scalars(
        select(User).where(User.id.in_(friend_ids)).order_by(User.first_name, User.last_name)
    )
    return list(friends)


@router.post("/friend-requests", status_code=status.HTTP_201_CREATED)
async def send_friend_request(
    payload: FriendRequestCreate, current_user: CurrentUser, db: DbSession
) -> dict[str, str]:
    code = payload.friend_code.removeprefix("#").upper()
    recipient = await db.scalar(select(User).where(User.friend_code == code))
    if recipient is None or not recipient.is_active:
        raise HTTPException(status_code=404, detail="Nie znaleziono aktywnego konta z tym identyfikatorem")
    if recipient.id == current_user.id:
        raise HTTPException(status_code=400, detail="Nie możesz wysłać zaproszenia do siebie")

    friendship = await _get_friendship(db, current_user.id, recipient.id)
    if friendship and friendship.status == "accepted":
        raise HTTPException(status_code=409, detail="Ta osoba jest już na liście znajomych")
    if friendship and friendship.status == "pending":
        raise HTTPException(status_code=409, detail="Zaproszenie do znajomych już oczekuje na odpowiedź")
    if friendship:
        friendship.requested_by_id = current_user.id
        friendship.status = "pending"
        friendship.created_at = datetime.now(UTC)
    else:
        low_id, high_id = _pair(current_user.id, recipient.id)
        friendship = Friendship(
            user_low_id=low_id,
            user_high_id=high_id,
            requested_by_id=current_user.id,
            status="pending",
        )
        db.add(friendship)
    await db.commit()
    return {"message": "Wysłano zaproszenie do znajomych."}


@router.post("/friend-requests/{request_id}/accept")
async def accept_friend_request(
    request_id: int, current_user: CurrentUser, db: DbSession
) -> dict[str, str]:
    friendship = await db.get(Friendship, request_id)
    if (
        friendship is None
        or friendship.status != "pending"
        or current_user.id not in (friendship.user_low_id, friendship.user_high_id)
        or friendship.requested_by_id == current_user.id
    ):
        raise HTTPException(status_code=404, detail="Nie znaleziono oczekującego zaproszenia")
    friendship.status = "accepted"
    await db.commit()
    return {"message": "Dodano do znajomych."}


@router.post("/friend-requests/{request_id}/reject")
async def reject_friend_request(
    request_id: int, current_user: CurrentUser, db: DbSession
) -> dict[str, str]:
    friendship = await db.get(Friendship, request_id)
    if (
        friendship is None
        or friendship.status != "pending"
        or current_user.id not in (friendship.user_low_id, friendship.user_high_id)
        or friendship.requested_by_id == current_user.id
    ):
        raise HTTPException(status_code=404, detail="Nie znaleziono oczekującego zaproszenia")
    friendship.status = "rejected"
    await db.commit()
    return {"message": "Odrzucono zaproszenie."}


@router.delete("/friends/{friend_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_friend(friend_id: int, current_user: CurrentUser, db: DbSession) -> None:
    friendship = await _get_friendship(db, current_user.id, friend_id)
    if friendship is None or friendship.status != "accepted":
        raise HTTPException(status_code=404, detail="Nie znaleziono znajomego")
    await db.delete(friendship)
    await db.commit()


@router.get("/notifications", response_model=list[NotificationItem])
async def list_notifications(current_user: CurrentUser, db: DbSession) -> list[NotificationItem]:
    friend_requests = await db.execute(
        select(Friendship, User)
        .join(User, User.id == Friendship.requested_by_id)
        .where(
            Friendship.status == "pending",
            Friendship.requested_by_id != current_user.id,
            or_(
                Friendship.user_low_id == current_user.id,
                Friendship.user_high_id == current_user.id,
            ),
        )
    )
    invitations = await db.execute(
        select(EventInvitation, User, Event)
        .join(User, User.id == EventInvitation.invited_by_id)
        .join(Event, Event.id == EventInvitation.event_id)
        .where(
            EventInvitation.invited_user_id == current_user.id,
            EventInvitation.status == "pending",
        )
    )
    items = [
        NotificationItem(
            type="friend_request",
            id=request.id,
            created_at=_as_utc(request.created_at),
            sender_name=sender.full_name,
            sender_user_id=sender.id,
        )
        for request, sender in friend_requests
    ]
    items.extend(
        NotificationItem(
            type="event_invitation",
            id=invitation.id,
            created_at=_as_utc(invitation.created_at),
            sender_name=sender.full_name,
            sender_user_id=sender.id,
            event_public_id=event.public_id,
            event_title=event.title,
        )
        for invitation, sender, event in invitations
    )
    return sorted(items, key=lambda item: item.created_at, reverse=True)


def _utc_range(start: datetime, end: datetime) -> tuple[datetime, datetime]:
    if start.tzinfo is None or start.utcoffset() is None or end.tzinfo is None or end.utcoffset() is None:
        raise HTTPException(status_code=422, detail="Zakres dat musi zawierać strefę czasową")
    start_utc, end_utc = start.astimezone(UTC), end.astimezone(UTC)
    if end_utc <= start_utc or end_utc - start_utc > timedelta(days=8):
        raise HTTPException(status_code=422, detail="Zakres kalendarza może obejmować najwyżej 8 dni")
    return start_utc, end_utc


@router.get("/availability", response_model=list[FriendAvailabilitySlotResponse])
async def friends_availability(
    current_user: CurrentUser,
    db: DbSession,
    start: Annotated[datetime, Query()],
    end: Annotated[datetime, Query()],
) -> list[FriendAvailabilitySlotResponse]:
    start_utc, end_utc = _utc_range(start, end)
    friendships = await db.scalars(
        select(Friendship).where(
            Friendship.status == "accepted",
            or_(
                Friendship.user_low_id == current_user.id,
                Friendship.user_high_id == current_user.id,
            ),
        )
    )
    friend_ids = [
        row.user_high_id if row.user_low_id == current_user.id else row.user_low_id
        for row in friendships
    ]
    if not friend_ids:
        return []
    rows = await db.execute(
        select(FriendAvailabilitySlot, User.first_name, User.last_name)
        .join(User, User.id == FriendAvailabilitySlot.user_id)
        .where(
            FriendAvailabilitySlot.user_id.in_(friend_ids),
            FriendAvailabilitySlot.slot_start >= start_utc,
            FriendAvailabilitySlot.slot_start < end_utc,
        )
        .order_by(FriendAvailabilitySlot.slot_start)
    )
    return [
        FriendAvailabilitySlotResponse(
            user_id=slot.user_id,
            first_name=first_name,
            last_name=last_name,
            slot_start=_as_utc(slot.slot_start),
            note=slot.note,
        )
        for slot, first_name, last_name in rows
    ]


@router.get("/availability/me", response_model=list[OwnFriendAvailabilitySlotResponse])
async def my_friend_availability(
    current_user: CurrentUser,
    db: DbSession,
    start: Annotated[datetime, Query()],
    end: Annotated[datetime, Query()],
) -> list[OwnFriendAvailabilitySlotResponse]:
    start_utc, end_utc = _utc_range(start, end)
    slots = await db.scalars(
        select(FriendAvailabilitySlot)
        .where(
            FriendAvailabilitySlot.user_id == current_user.id,
            FriendAvailabilitySlot.slot_start >= start_utc,
            FriendAvailabilitySlot.slot_start < end_utc,
        )
        .order_by(FriendAvailabilitySlot.slot_start)
    )
    return [
        OwnFriendAvailabilitySlotResponse(slot_start=_as_utc(slot.slot_start), note=slot.note)
        for slot in slots
    ]


@router.put("/availability/me", response_model=list[OwnFriendAvailabilitySlotResponse])
async def save_my_friend_availability(
    payload: FriendAvailabilitySet, current_user: CurrentUser, db: DbSession
) -> list[OwnFriendAvailabilitySlotResponse]:
    start_utc, end_utc = _utc_range(payload.start, payload.end)
    normalized: set[datetime] = set()
    for slot in payload.slot_starts:
        if slot.tzinfo is None or slot.utcoffset() is None:
            raise HTTPException(status_code=422, detail="Godzina musi zawierać strefę czasową")
        if slot.minute not in (0, 30) or slot.second or slot.microsecond:
            raise HTTPException(status_code=422, detail="Dostępność wybiera się co 30 minut")
        normalized_slot = slot.astimezone(UTC)
        if not start_utc <= normalized_slot < end_utc:
            raise HTTPException(status_code=422, detail="Termin wykracza poza wybrany tydzień")
        normalized.add(normalized_slot)
    normalized_notes: dict[datetime, str] = {}
    for slot, note in payload.slot_notes.items():
        if slot.tzinfo is None or slot.utcoffset() is None:
            raise HTTPException(status_code=422, detail="Godzina notatki musi zawierać strefę czasową")
        if len(note) > 500:
            raise HTTPException(status_code=422, detail="Notatka może mieć najwyżej 500 znaków")
        normalized_notes[slot.astimezone(UTC)] = note.strip()
    await db.execute(
        delete(FriendAvailabilitySlot).where(
            FriendAvailabilitySlot.user_id == current_user.id,
            FriendAvailabilitySlot.slot_start >= start_utc,
            FriendAvailabilitySlot.slot_start < end_utc,
        )
    )
    db.add_all(
        FriendAvailabilitySlot(
            user_id=current_user.id,
            slot_start=slot,
            note=normalized_notes.get(slot, ""),
        )
        for slot in sorted(normalized)
    )
    await db.commit()
    return [
        OwnFriendAvailabilitySlotResponse(
            slot_start=slot,
            note=normalized_notes.get(slot, ""),
        )
        for slot in sorted(normalized)
    ]
