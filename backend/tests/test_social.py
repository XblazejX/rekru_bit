from datetime import UTC, datetime, timedelta

import pytest

from app.api import auth


@pytest.fixture
def sent_codes(monkeypatch: pytest.MonkeyPatch) -> dict[str, str]:
    codes: dict[str, str] = {}

    async def fake_send(recipient: str, code: str, purpose: str) -> None:
        codes[recipient] = code

    monkeypatch.setattr(auth, "send_auth_code", fake_send)
    return codes


async def create_account(client, sent_codes: dict[str, str], email: str, first_name: str):
    registration = {
        "first_name": first_name,
        "last_name": "Tester",
        "email": email,
        "password": "SuperHaslo123!",
        "confirm_password": "SuperHaslo123!",
        "notify_on_events": True,
    }
    created = await client.post("/api/auth/register", json=registration)
    assert created.status_code == 202
    verified = await client.post(
        "/api/auth/verify", json={"email": email, "code": sent_codes[email]}
    )
    assert verified.status_code == 200
    return {"Authorization": f"Bearer {verified.json()['access_token']}"}


@pytest.mark.asyncio
async def test_friend_request_shared_schedule_and_event_invitation(
    async_client, sent_codes
):
    alice = await create_account(async_client, sent_codes, "alice@example.com", "Ala")
    bob = await create_account(async_client, sent_codes, "bob@example.com", "Bartek")
    bob_profile = await async_client.get("/api/auth/me", headers=bob)

    sent = await async_client.post(
        "/api/social/friend-requests",
        headers=alice,
        json={"friend_code": f"#{bob_profile.json()['friend_code']}"},
    )
    assert sent.status_code == 201
    notifications = await async_client.get("/api/social/notifications", headers=bob)
    assert len(notifications.json()) == 1
    request_id = notifications.json()[0]["id"]
    accepted = await async_client.post(
        f"/api/social/friend-requests/{request_id}/accept", headers=bob
    )
    assert accepted.status_code == 200
    alice_friends = (await async_client.get("/api/social/friends", headers=alice)).json()
    assert alice_friends[0]["first_name"] == "Bartek"
    friend_id = alice_friends[0]["id"]

    event = await async_client.post(
        "/api/events", headers=alice, json={"title": "Kino ze znajomymi", "description": ""}
    )
    assert event.status_code == 201
    public_id = event.json()["public_id"]
    invite = await async_client.post(
        f"/api/events/{public_id}/invitations", headers=alice, json={"friend_id": friend_id}
    )
    assert invite.status_code == 201
    invite_notification = await async_client.get("/api/social/notifications", headers=bob)
    assert invite_notification.json()[0]["type"] == "event_invitation"
    invitation_id = invite_notification.json()[0]["id"]
    joined = await async_client.post(
        f"/api/events/invitations/{invitation_id}/accept", headers=bob, json={}
    )
    assert joined.status_code == 200
    assert joined.json()["is_member"] is True

    start = datetime(2026, 10, 19, tzinfo=UTC)
    end = start + timedelta(days=7)
    saved = await async_client.put(
        "/api/social/availability/me",
        headers=bob,
        json={
            "start": start.isoformat(),
            "end": end.isoformat(),
            "slot_starts": [start.replace(hour=18).isoformat()],
            "slot_notes": {start.replace(hour=18).isoformat(): "Mogę dopiero po pracy"},
        },
    )
    assert saved.status_code == 200
    shared = await async_client.get(
        "/api/social/availability",
        headers=alice,
        params={"start": start.isoformat(), "end": end.isoformat()},
    )
    assert len(shared.json()) == 1
    assert shared.json()[0]["first_name"] == "Bartek"
    assert shared.json()[0]["note"] == "Mogę dopiero po pracy"

    removed = await async_client.delete(f"/api/social/friends/{friend_id}", headers=alice)
    assert removed.status_code == 204
    no_longer_shared = await async_client.get(
        "/api/social/availability",
        headers=alice,
        params={"start": start.isoformat(), "end": end.isoformat()},
    )
    assert no_longer_shared.json() == []


@pytest.mark.asyncio
async def test_event_availability_participants_include_names_and_optional_notes(
    async_client, sent_codes
):
    owner = await create_account(async_client, sent_codes, "event-owner@example.com", "Ala")
    participant = await create_account(async_client, sent_codes, "event-participant@example.com", "Bartek")
    outsider = await create_account(async_client, sent_codes, "event-outsider@example.com", "Celina")
    event = await async_client.post(
        "/api/events", headers=owner, json={"title": "Wyjście", "description": ""}
    )
    public_id = event.json()["public_id"]
    joined = await async_client.post(f"/api/events/{public_id}/join", headers=participant)
    assert joined.status_code == 200

    monday = datetime(2026, 10, 19, tzinfo=UTC)
    first_slot = monday.replace(hour=18)
    second_slot = monday.replace(hour=18, minute=30)
    saved = await async_client.put(
        f"/api/events/{public_id}/availability/me",
        headers=participant,
        json={
            "slot_starts": [first_slot.isoformat(), second_slot.isoformat()],
            "slot_notes": {first_slot.isoformat(): "Po pracy"},
        },
    )
    assert saved.status_code == 200

    details = await async_client.get(
        f"/api/events/{public_id}/availability/participants",
        headers=owner,
        params={"start": monday.isoformat(), "end": (monday + timedelta(days=7)).isoformat()},
    )
    assert details.status_code == 200
    assert details.json() == [
        {
            "slot_start": first_slot.isoformat().replace("+00:00", "Z"),
            "user_id": saved.json()[0]["user_id"],
            "user_name": "Bartek Tester",
            "note": "Po pracy",
        },
        {
            "slot_start": second_slot.isoformat().replace("+00:00", "Z"),
            "user_id": saved.json()[0]["user_id"],
            "user_name": "Bartek Tester",
            "note": "",
        },
    ]
    forbidden = await async_client.get(
        f"/api/events/{public_id}/availability/participants",
        headers=outsider,
        params={"start": monday.isoformat(), "end": (monday + timedelta(days=7)).isoformat()},
    )
    assert forbidden.status_code == 403


@pytest.mark.asyncio
async def test_custom_friend_code_is_unique(async_client, sent_codes):
    alice = await create_account(async_client, sent_codes, "code-alice@example.com", "Ala")
    bob = await create_account(async_client, sent_codes, "code-bob@example.com", "Bartek")
    alice_code = (await async_client.get("/api/auth/me", headers=alice)).json()["friend_code"]

    collision = await async_client.patch(
        "/api/auth/me",
        headers=bob,
        json={"friend_code": alice_code.lower(), "password": "SuperHaslo123!"},
    )
    assert collision.status_code == 409

    changed = await async_client.patch(
        "/api/auth/me",
        headers=bob,
        json={"friend_code": "a1b2c3", "password": "SuperHaslo123!"},
    )
    assert changed.status_code == 200
    assert changed.json()["friend_code"] == "A1B2C3"

    added = await async_client.post(
        "/api/social/friend-requests", headers=alice, json={"friend_code": "#a1b2c3"}
    )
    assert added.status_code == 201
