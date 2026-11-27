from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.games.lobby import LobbyHub, get_lobby_hub
from app.games.registry import GameRegistry, get_registry
from app.main import app
from app.settings import Settings, get_settings


@pytest.fixture
def client() -> Iterator[TestClient]:
    registry = GameRegistry()
    hub = LobbyHub()
    settings = Settings(app_version="dev", allowed_origins=["https://game.example"])
    app.dependency_overrides[get_registry] = lambda: registry
    app.dependency_overrides[get_lobby_hub] = lambda: hub
    app.dependency_overrides[get_settings] = lambda: settings
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


@pytest.mark.parametrize(
    "origin", ["https://evil.example", "http://localhost:5173", "null", ""]
)
def test_foreign_origin_is_rejected_before_accepting(
    client: TestClient, origin: str
) -> None:
    with pytest.raises(WebSocketDisconnect) as rejection:
        with client.websocket_connect("/api/ws", headers={"Origin": origin}):
            pass

    assert rejection.value.code == 1008


@pytest.mark.parametrize("headers", [{"Origin": "https://game.example"}, {}])
def test_allowed_or_missing_origin_is_accepted(
    client: TestClient, headers: dict[str, str]
) -> None:
    with client.websocket_connect("/api/ws", headers=headers) as socket:
        socket.send_json({"type": "subscribe_lobby"})

        assert socket.receive_json() == {"type": "games_list", "games": []}
