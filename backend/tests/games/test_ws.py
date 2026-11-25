import asyncio
from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient
from starlette.testclient import WebSocketTestSession

from app.games.lobby import LobbyHub, get_lobby_hub
from app.games.models import Color, Game, Player
from app.games.registry import GameRegistry, get_registry
from app.games.ws import ClientSession
from app.main import app


PROBE_REPLY = {"type": "error", "code": "invalid_message"}


@pytest.fixture
def registry() -> Iterator[GameRegistry]:
    fresh_registry = GameRegistry()
    app.dependency_overrides[get_registry] = lambda: fresh_registry
    fresh_hub = LobbyHub()
    app.dependency_overrides[get_lobby_hub] = lambda: fresh_hub
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


def pending_messages(socket: WebSocketTestSession) -> list[Any]:
    """Everything the server sent that this socket has not read yet.

    Reads up to the reply to a probe, so a missing message fails the test
    instead of blocking it.
    """
    socket.send_text("probe")
    messages: list[Any] = []
    while (message := socket.receive_json()) != PROBE_REPLY:
        messages.append(message)
    return messages


def listed_names(messages: list[Any]) -> list[list[str]]:
    assert all(message["type"] == "games_list" for message in messages)
    return [[game["name"] for game in message["games"]] for message in messages]


def request(socket: WebSocketTestSession, message: dict[str, Any]) -> list[Any]:
    """Send a message and return the replies, once the server has handled it."""
    socket.send_json(message)
    return pending_messages(socket)


def subscribe(socket: WebSocketTestSession) -> list[list[str]]:
    return listed_names(request(socket, {"type": "subscribe_lobby"}))


def test_subscribe_to_an_empty_lobby(client: TestClient) -> None:
    with client.websocket_connect("/api/ws") as socket:
        socket.send_json({"type": "subscribe_lobby"})

        assert socket.receive_json() == {"type": "games_list", "games": []}


def test_subscribe_lists_games_created_on_other_connections(
    client: TestClient,
) -> None:
    with client.websocket_connect("/api/ws") as creator:
        request(creator, create_message())
        with client.websocket_connect("/api/ws") as watcher:
            assert subscribe(watcher) == [["Partida 1"]]


def test_subscribing_twice_sends_two_snapshots_but_each_update_once(
    client: TestClient,
) -> None:
    with client.websocket_connect("/api/ws") as watcher:
        assert subscribe(watcher) == [[]]
        assert subscribe(watcher) == [[]]

        with client.websocket_connect("/api/ws") as creator:
            request(creator, create_message())

            assert listed_names(pending_messages(watcher)) == [["Partida 1"]]


def test_creating_a_game_updates_subscribers(client: TestClient) -> None:
    with (
        client.websocket_connect("/api/ws") as watcher,
        client.websocket_connect("/api/ws") as creator,
    ):
        subscribe(watcher)

        request(creator, create_message())

        assert listed_names(pending_messages(watcher)) == [["Partida 1"]]


def test_creator_is_confirmed_before_receiving_the_new_list(
    client: TestClient,
) -> None:
    with client.websocket_connect("/api/ws") as creator:
        subscribe(creator)

        replies = request(creator, create_message())

        assert [reply["type"] for reply in replies] == ["game_created", "games_list"]


@pytest.mark.parametrize(
    ("overrides", "code"),
    [
        ({"gameName": "x"}, "invalid_game_name"),
        ({"gameName": "partida 1"}, "name_taken"),
    ],
)
def test_rejected_creation_sends_no_update(
    client: TestClient, overrides: dict[str, Any], code: str
) -> None:
    with (
        client.websocket_connect("/api/ws") as owner,
        client.websocket_connect("/api/ws") as watcher,
        client.websocket_connect("/api/ws") as other,
    ):
        request(owner, create_message())
        subscribe(watcher)

        replies = request(other, create_message(**overrides))

        assert [reply["code"] for reply in replies] == [code]
        assert pending_messages(watcher) == []


def test_second_game_on_a_connection_sends_no_update(client: TestClient) -> None:
    with (
        client.websocket_connect("/api/ws") as watcher,
        client.websocket_connect("/api/ws") as creator,
    ):
        request(creator, create_message())
        subscribe(watcher)

        replies = request(creator, create_message(gameName="Duel"))

        assert replies == [{"type": "error", "code": "already_in_game"}]
        assert pending_messages(watcher) == []


def test_cancelling_a_game_updates_subscribers(client: TestClient) -> None:
    with (
        client.websocket_connect("/api/ws") as watcher,
        client.websocket_connect("/api/ws") as creator,
    ):
        request(creator, create_message())
        subscribe(watcher)

        replies = request(creator, {"type": "cancel_game"})

        assert replies == [{"type": "game_cancelled"}]
        assert listed_names(pending_messages(watcher)) == [[]]


def test_creator_disconnect_updates_subscribers(client: TestClient) -> None:
    with client.websocket_connect("/api/ws") as watcher:
        with client.websocket_connect("/api/ws") as creator:
            request(creator, create_message())
            subscribe(watcher)

        assert listed_names(pending_messages(watcher)) == [[]]


def test_cancel_without_a_game_sends_no_update(client: TestClient) -> None:
    with (
        client.websocket_connect("/api/ws") as watcher,
        client.websocket_connect("/api/ws") as other,
    ):
        subscribe(watcher)

        replies = request(other, {"type": "cancel_game"})

        assert replies == [{"type": "game_cancelled"}]
        assert pending_messages(watcher) == []


def test_disconnect_without_a_game_sends_no_update(client: TestClient) -> None:
    with client.websocket_connect("/api/ws") as watcher:
        subscribe(watcher)
        with client.websocket_connect("/api/ws") as other:
            pending_messages(other)

        assert pending_messages(watcher) == []


def test_subscribed_creator_keeps_receiving_updates(client: TestClient) -> None:
    with (
        client.websocket_connect("/api/ws") as creator,
        client.websocket_connect("/api/ws") as other,
    ):
        subscribe(creator)
        request(creator, create_message())

        request(other, create_message(gameName="Duel"))

        assert listed_names(pending_messages(creator)) == [["Duel", "Partida 1"]]


class RecordingHub(LobbyHub):
    def __init__(self) -> None:
        super().__init__()
        self.subscriber_counts_at_broadcast: list[int] = []

    async def broadcast(self, message: dict[str, Any]) -> None:
        self.subscriber_counts_at_broadcast.append(len(self._subscribers))
        await super().broadcast(message)


def test_disconnecting_socket_is_unsubscribed_before_the_broadcast(
    client: TestClient,
) -> None:
    hub = RecordingHub()
    app.dependency_overrides[get_lobby_hub] = lambda: hub

    with client.websocket_connect("/api/ws") as creator:
        subscribe(creator)
        request(creator, create_message())

    # On create the creator is subscribed; on disconnect it must be gone.
    assert hub.subscriber_counts_at_broadcast == [1, 0]


class CancelReplyFails:
    async def send_json(self, message: dict[str, Any]) -> None:
        if message["type"] == "game_cancelled":
            raise RuntimeError("connection is gone")


class RecordingSocket:
    def __init__(self) -> None:
        self.sent: list[Any] = []

    async def send_json(self, message: Any) -> None:
        self.sent.append(message)


def test_cancel_updates_subscribers_even_if_the_creator_is_gone() -> None:
    hub, watcher = LobbyHub(), RecordingSocket()
    session = ClientSession(CancelReplyFails(), GameRegistry(), hub)

    async def create_then_cancel() -> None:
        await session.handle(create_message())
        hub.subscribe(watcher)
        with pytest.raises(RuntimeError):
            await session.handle({"type": "cancel_game"})

    asyncio.run(create_then_cancel())

    assert listed_names(watcher.sent) == [[]]
