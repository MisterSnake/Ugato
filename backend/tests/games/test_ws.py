from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.games.models import Color, Game, Player
from app.games.registry import GameRegistry, get_registry
from app.main import app


@pytest.fixture
def registry() -> Iterator[GameRegistry]:
    fresh_registry = GameRegistry()
    app.dependency_overrides[get_registry] = lambda: fresh_registry
    yield fresh_registry
    app.dependency_overrides.clear()


@pytest.fixture
def client(registry: GameRegistry) -> Iterator[TestClient]:
    # Entering the client makes every socket share one event loop, as in uvicorn.
    with TestClient(app) as test_client:
        yield test_client


def create_message(**overrides: Any) -> dict[str, Any]:
    message: dict[str, Any] = {
        "type": "create_game",
        "username": "Esteban",
        "color": "red",
        "gameName": "Partida 1",
        "maxPlayers": 2,
        "boardWidth": 12,
        "boardHeight": 10,
    }
    message.update(overrides)
    return message


def test_create_game_replies_with_summary_and_stores_game(
    client: TestClient, registry: GameRegistry
) -> None:
    with client.websocket_connect("/api/ws") as socket:
        socket.send_json(create_message())

        assert socket.receive_json() == {
            "type": "game_created",
            "game": {
                "name": "Partida 1",
                "maxPlayers": 2,
                "boardWidth": 12,
                "boardHeight": 10,
                "players": [{"name": "Esteban", "color": "red"}],
            },
        }
        assert registry.list() == [
            Game(
                name="Partida 1",
                max_players=2,
                board_width=12,
                board_height=10,
                players=[Player(name="Esteban", color=Color.RED)],
            )
        ]


def test_validation_error_is_reported_and_socket_stays_usable(
    client: TestClient, registry: GameRegistry
) -> None:
    with client.websocket_connect("/api/ws") as socket:
        socket.send_json(create_message(boardWidth=8, boardHeight=30))

        assert socket.receive_json() == {
            "type": "error",
            "field": "board",
            "code": "invalid_board",
        }
        assert registry.list() == []

        socket.send_json(create_message())
        assert socket.receive_json()["type"] == "game_created"


def test_duplicate_name_from_another_connection_is_rejected(
    client: TestClient, registry: GameRegistry
) -> None:
    with client.websocket_connect("/api/ws") as first:
        first.send_json(create_message(gameName="Partida 1"))
        assert first.receive_json()["type"] == "game_created"

        with client.websocket_connect("/api/ws") as second:
            second.send_json(create_message(gameName=" partida 1"))

            assert second.receive_json() == {
                "type": "error",
                "field": "gameName",
                "code": "name_taken",
            }
            assert [game.name for game in registry.list()] == ["Partida 1"]


def test_second_create_on_the_same_connection_is_rejected(
    client: TestClient, registry: GameRegistry
) -> None:
    with client.websocket_connect("/api/ws") as socket:
        socket.send_json(create_message(gameName="Partida 1"))
        assert socket.receive_json()["type"] == "game_created"

        socket.send_json(create_message(gameName="Partida 2"))

        assert socket.receive_json() == {"type": "error", "code": "already_in_game"}
        assert [game.name for game in registry.list()] == ["Partida 1"]


def test_cancel_removes_the_game_and_frees_its_name(
    client: TestClient, registry: GameRegistry
) -> None:
    with client.websocket_connect("/api/ws") as creator:
        creator.send_json(create_message())
        assert creator.receive_json()["type"] == "game_created"

        creator.send_json({"type": "cancel_game"})

        assert creator.receive_json() == {"type": "game_cancelled"}
        assert registry.list() == []

        with client.websocket_connect("/api/ws") as other:
            other.send_json(create_message())
            assert other.receive_json()["type"] == "game_created"


def test_connection_can_create_again_after_cancelling(
    client: TestClient, registry: GameRegistry
) -> None:
    with client.websocket_connect("/api/ws") as socket:
        socket.send_json(create_message())
        assert socket.receive_json()["type"] == "game_created"
        socket.send_json({"type": "cancel_game"})
        assert socket.receive_json()["type"] == "game_cancelled"

        socket.send_json(create_message(gameName="Partida 2"))

        assert socket.receive_json()["type"] == "game_created"
        assert [game.name for game in registry.list()] == ["Partida 2"]


def test_disconnect_removes_the_game_and_frees_its_name(
    client: TestClient, registry: GameRegistry
) -> None:
    with client.websocket_connect("/api/ws") as creator:
        creator.send_json(create_message())
        assert creator.receive_json()["type"] == "game_created"

    assert registry.list() == []
    with client.websocket_connect("/api/ws") as other:
        other.send_json(create_message())
        assert other.receive_json()["type"] == "game_created"


@pytest.mark.parametrize(
    "text",
    [
        "not json",
        "[1, 2]",
        '"create_game"',
        "{}",
        '{"type": "unknown"}',
        "[" * 100_000,
    ],
)
def test_invalid_message_is_reported_and_socket_stays_open(
    client: TestClient, registry: GameRegistry, text: str
) -> None:
    with client.websocket_connect("/api/ws") as socket:
        socket.send_text(text)
        assert socket.receive_json() == {"type": "error", "code": "invalid_message"}

        socket.send_json(create_message())
        assert socket.receive_json()["type"] == "game_created"


def test_binary_frame_is_invalid_and_keeps_the_game(
    client: TestClient, registry: GameRegistry
) -> None:
    with client.websocket_connect("/api/ws") as socket:
        socket.send_json(create_message())
        assert socket.receive_json()["type"] == "game_created"

        socket.send_bytes(b"\x00\x01")

        assert socket.receive_json() == {"type": "error", "code": "invalid_message"}
        assert len(registry.list()) == 1
