import pytest
from fastapi.testclient import TestClient

from app.main import create_app


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.setenv("ALLOWED_ORIGINS", "https://game.example")
    return TestClient(create_app())


def test_cors_allows_a_configured_origin(client: TestClient) -> None:
    response = client.get("/api/health", headers={"Origin": "https://game.example"})

    assert response.headers["access-control-allow-origin"] == "https://game.example"


@pytest.mark.parametrize("origin", ["https://evil.example", "http://localhost:5173"])
def test_cors_ignores_any_other_origin(client: TestClient, origin: str) -> None:
    response = client.get("/api/health", headers={"Origin": origin})

    assert "access-control-allow-origin" not in response.headers
