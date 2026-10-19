from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_root_endpoint(async_client: AsyncClient):
    response = await async_client.get("/")
    assert response.status_code == 200
    data = response.json()
    assert data["name"] == "Bit2Meet"
    assert "health" in data


@pytest.mark.asyncio
async def test_health_endpoint(async_client: AsyncClient):
    response = await async_client.get("/api/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert data["app"] == "Bit2Meet"
    assert "environment" in data


@pytest.mark.asyncio
async def test_db_health_success(async_client: AsyncClient):
    with patch(
        "app.api.health.check_database_connection",
        new_callable=AsyncMock,
    ) as mock_check:
        mock_check.return_value = True
        response = await async_client.get("/api/health/db")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "ok"
        assert data["database"] == "connected"


@pytest.mark.asyncio
async def test_db_health_failure(async_client: AsyncClient):
    with patch(
        "app.api.health.check_database_connection",
        new_callable=AsyncMock,
    ) as mock_check:
        mock_check.return_value = False
        response = await async_client.get("/api/health/db")
        assert response.status_code == 503
        data = response.json()
        assert data["detail"]["status"] == "error"
        assert data["detail"]["database"] == "disconnected"
