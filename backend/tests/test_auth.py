from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select

from app.api import auth
from app.models.user import User


@pytest.fixture
def sent_codes(monkeypatch: pytest.MonkeyPatch) -> list[tuple[str, str, str]]:
    messages: list[tuple[str, str, str]] = []

    async def fake_send(recipient: str, code: str, purpose: str) -> None:
        messages.append((recipient, code, purpose))

    monkeypatch.setattr(auth, "send_auth_code", fake_send)
    return messages


def registration_payload(email: str = "ola@example.com") -> dict[str, object]:
    return {
        "first_name": "Ola",
        "last_name": "Nowak",
        "email": email,
        "password": "SuperHaslo123!",
        "confirm_password": "SuperHaslo123!",
        "notify_on_events": False,
    }


@pytest.mark.asyncio
async def test_register_verify_login_and_get_profile(async_client, async_session, sent_codes):
    response = await async_client.post("/api/auth/register", json=registration_payload())
    assert response.status_code == 202
    user = await async_session.scalar(select(User).where(User.email == "ola@example.com"))
    assert user is not None
    assert user.is_active is False
    assert user.password_hash != "SuperHaslo123!"
    assert user.verification_code_hash != sent_codes[0][1]
    assert user.notify_on_events is False

    inactive_login = await async_client.post(
        "/api/auth/login", json={"email": "ola@example.com", "password": "SuperHaslo123!"}
    )
    assert inactive_login.status_code == 403

    verified = await async_client.post(
        "/api/auth/verify",
        json={"email": "ola@example.com", "code": sent_codes[0][1]},
    )
    assert verified.status_code == 200
    token = verified.json()["access_token"]
    assert verified.json()["user"]["is_active"] is True

    login = await async_client.post(
        "/api/auth/login", json={"email": "ola@example.com", "password": "SuperHaslo123!"}
    )
    assert login.status_code == 200
    me = await async_client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 200
    assert me.json()["email"] == "ola@example.com"


@pytest.mark.asyncio
async def test_verify_rejects_wrong_and_expired_codes(async_client, async_session, sent_codes):
    await async_client.post("/api/auth/register", json=registration_payload())
    wrong = "000000" if sent_codes[0][1] != "000000" else "000001"
    wrong_code = await async_client.post(
        "/api/auth/verify", json={"email": "ola@example.com", "code": wrong}
    )
    assert wrong_code.status_code == 400

    user = await async_session.scalar(select(User).where(User.email == "ola@example.com"))
    assert user is not None
    user.verification_code_expires_at = datetime.now(UTC) - timedelta(seconds=1)
    await async_session.commit()
    expired = await async_client.post(
        "/api/auth/verify",
        json={"email": "ola@example.com", "code": sent_codes[0][1]},
    )
    assert expired.status_code == 400


@pytest.mark.asyncio
async def test_resend_code_replaces_previous_code(async_client, async_session, sent_codes):
    await async_client.post("/api/auth/register", json=registration_payload())
    first_code = sent_codes[0][1]
    response = await async_client.post("/api/auth/resend-code", json={"email": "ola@example.com"})
    assert response.status_code == 202
    assert len(sent_codes) == 2
    assert sent_codes[1][1] != first_code

    old_code = await async_client.post(
        "/api/auth/verify", json={"email": "ola@example.com", "code": first_code}
    )
    assert old_code.status_code == 400
    new_code = await async_client.post(
        "/api/auth/verify", json={"email": "ola@example.com", "code": sent_codes[1][1]}
    )
    assert new_code.status_code == 200


@pytest.mark.asyncio
async def test_verification_code_has_attempt_limit(async_client, sent_codes):
    await async_client.post("/api/auth/register", json=registration_payload())
    wrong = "000000" if sent_codes[0][1] != "000000" else "000001"
    for _ in range(5):
        response = await async_client.post(
            "/api/auth/verify", json={"email": "ola@example.com", "code": wrong}
        )
        assert response.status_code == 400
    blocked = await async_client.post(
        "/api/auth/verify",
        json={"email": "ola@example.com", "code": sent_codes[0][1]},
    )
    assert blocked.status_code == 429

    await async_client.post("/api/auth/resend-code", json={"email": "ola@example.com"})
    verified = await async_client.post(
        "/api/auth/verify",
        json={"email": "ola@example.com", "code": sent_codes[-1][1]},
    )
    assert verified.status_code == 200


@pytest.mark.asyncio
async def test_forgot_and_reset_password(async_client, async_session, sent_codes):
    await async_client.post("/api/auth/register", json=registration_payload())
    await async_client.post(
        "/api/auth/verify", json={"email": "ola@example.com", "code": sent_codes[0][1]}
    )
    response = await async_client.post(
        "/api/auth/forgot-password", json={"email": "ola@example.com"}
    )
    assert response.status_code == 202
    reset_code = sent_codes[-1][1]

    reset = await async_client.post(
        "/api/auth/reset-password",
        json={
            "email": "ola@example.com",
            "code": reset_code,
            "new_password": "NoweHaslo123!",
            "confirm_new_password": "NoweHaslo123!",
        },
    )
    assert reset.status_code == 200
    assert (
        await async_client.post(
            "/api/auth/login", json={"email": "ola@example.com", "password": "NoweHaslo123!"}
        )
    ).status_code == 200
    assert (
        await async_client.post(
            "/api/auth/login", json={"email": "ola@example.com", "password": "SuperHaslo123!"}
        )
    ).status_code == 401


@pytest.mark.asyncio
async def test_profile_requires_token_and_updates_preferences(async_client, sent_codes):
    unauthorized = await async_client.get("/api/auth/me")
    assert unauthorized.status_code == 401
    await async_client.post("/api/auth/register", json=registration_payload())
    verified = await async_client.post(
        "/api/auth/verify", json={"email": "ola@example.com", "code": sent_codes[0][1]}
    )
    headers = {"Authorization": f"Bearer {verified.json()['access_token']}"}
    updated = await async_client.patch(
        "/api/auth/me",
        headers=headers,
        json={"theme": "light", "notify_on_events": True},
    )
    assert updated.status_code == 200
    assert updated.json()["theme"] == "light"
    assert updated.json()["notify_on_events"] is True

    invalid_token = await async_client.get(
        "/api/auth/me", headers={"Authorization": "Bearer invalid.token.value"}
    )
    assert invalid_token.status_code == 401


@pytest.mark.asyncio
async def test_registration_rejects_mismatched_passwords(async_client):
    payload = registration_payload()
    payload["confirm_password"] = "different"
    response = await async_client.post("/api/auth/register", json=payload)
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_reset_rejects_expired_code(async_client, async_session, sent_codes):
    await async_client.post("/api/auth/register", json=registration_payload())
    await async_client.post(
        "/api/auth/verify", json={"email": "ola@example.com", "code": sent_codes[0][1]}
    )
    await async_client.post("/api/auth/forgot-password", json={"email": "ola@example.com"})
    user = await async_session.scalar(select(User).where(User.email == "ola@example.com"))
    assert user is not None
    user.reset_password_expires_at = datetime.now(UTC) - timedelta(seconds=1)
    await async_session.commit()
    response = await async_client.post(
        "/api/auth/reset-password",
        json={
            "email": "ola@example.com",
            "code": sent_codes[-1][1],
            "new_password": "NoweHaslo123!",
            "confirm_new_password": "NoweHaslo123!",
        },
    )
    assert response.status_code == 400
