from datetime import UTC, date, datetime

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.availability import AvailabilitySlot
from app.models.event import Event
from app.models.message import EventMessage
from app.models.participant import EventParticipant
from app.models.user import User


@pytest.mark.asyncio
async def test_create_user_and_properties(async_session: AsyncSession):
    user = User(
        first_name="Jan",
        last_name="Kowalski",
        email="jan.kowalski@example.com",
        password_hash="hashed_pw_123",
    )
    async_session.add(user)
    await async_session.commit()
    await async_session.refresh(user)

    assert user.id is not None
    assert user.full_name == "Jan Kowalski"
    assert user.theme == "dark"
    assert user.is_active is False
    assert user.notify_on_events is True
    assert user.created_at is not None


@pytest.mark.asyncio
async def test_user_unique_email_constraint(async_session: AsyncSession):
    user1 = User(
        first_name="Anna",
        last_name="Nowak",
        email="duplicate@example.com",
        password_hash="pw1",
    )
    async_session.add(user1)
    await async_session.commit()

    user2 = User(
        first_name="Piotr",
        last_name="Nowak",
        email="duplicate@example.com",
        password_hash="pw2",
    )
    async_session.add(user2)
    with pytest.raises(IntegrityError):
        await async_session.commit()
    await async_session.rollback()


@pytest.mark.asyncio
async def test_event_creation_and_cascade(async_session: AsyncSession):
    owner = User(
        first_name="Tomasz",
        last_name="Lis",
        email="tomasz.lis@example.com",
        password_hash="pw",
    )
    async_session.add(owner)
    await async_session.commit()
    await async_session.refresh(owner)

    event = Event(
        title="Spotkanie zespołu BIT",
        description="Planowanie sprintu",
        owner_id=owner.id,
        start_date=date(2026, 11, 1),
        end_date=date(2026, 11, 5),
        slot_minutes=30,
    )
    async_session.add(event)
    await async_session.commit()
    await async_session.refresh(event)

    assert event.id is not None
    assert event.public_id is not None
    assert len(event.public_id) >= 10

    # Dodanie uczestnika
    participant = EventParticipant(event_id=event.id, user_id=owner.id)
    async_session.add(participant)

    # Dodanie slotu dostępności
    slot_time = datetime(2026, 11, 2, 10, 0, tzinfo=UTC)
    slot = AvailabilitySlot(event_id=event.id, user_id=owner.id, slot_start=slot_time)
    async_session.add(slot)

    # Dodanie wiadomości
    msg = EventMessage(event_id=event.id, user_id=owner.id, body="Cześć wszystkim!")
    async_session.add(msg)
    await async_session.commit()

    # Zapisujemy ID przed rollbackiem
    event_id = event.id
    owner_id = owner.id

    # Weryfikacja unikalności slotu (event_id, user_id, slot_start)
    duplicate_slot = AvailabilitySlot(
        event_id=event_id, user_id=owner_id, slot_start=slot_time
    )
    async_session.add(duplicate_slot)
    with pytest.raises(IntegrityError):
        await async_session.commit()
    await async_session.rollback()

    # Weryfikacja usunięcia kaskadowego po usunięciu wydarzenia
    event_to_delete = await async_session.get(Event, event_id)
    assert event_to_delete is not None
    await async_session.delete(event_to_delete)
    await async_session.commit()

    # Sloty, uczestnicy i wiadomości powiązane z wydarzeniem powinny zostać usunięte
    slots = await async_session.execute(
        select(AvailabilitySlot).where(AvailabilitySlot.event_id == event_id)
    )
    assert slots.scalars().all() == []

    messages = await async_session.execute(
        select(EventMessage).where(EventMessage.event_id == event_id)
    )
    assert messages.scalars().all() == []
