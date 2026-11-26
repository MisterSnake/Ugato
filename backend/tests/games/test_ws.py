import asyncio
import time
from collections.abc import Callable, Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient
from starlette.testclient import WebSocketTestSession

from app.games.board import Cell
from app.games.lobby import LobbyHub, get_lobby_hub
from app.games.match import get_random, get_timer_modes, get_vote_seconds
from app.games.models import Color, Game, Player, TimerMode
from app.games.registry import GameRegistry, get_registry
from app.games.rooms import GameRooms, get_game_rooms
from app.games.validation import TIMER_MODES, TimerSettings
from app.games.ws import ClientSession, Timing, get_grace_seconds
from app.main import app
from tests.games.randomness import FixedOrder


PROBE_REPLY = {"type": "error", "code": "invalid_message"}
# The turn order of every game started through the `client` fixture.
TURN_ORDER = FixedOrder("Ana", "Esteban", "Luis")


@pytest.fixture
def registry() -> Iterator[GameRegistry]:
    fresh_registry = GameRegistry()
    app.dependency_overrides[get_registry] = lambda: fresh_registry
    fresh_hub = LobbyHub()
    app.dependency_overrides[get_lobby_hub] = lambda: fresh_hub
    fresh_rooms = GameRooms()
    app.dependency_overrides[get_game_rooms] = lambda: fresh_rooms
    app.dependency_overrides[get_random] = lambda: TURN_ORDER
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
                "timer": "none",
                "status": "waiting",
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
    session = ClientSession(CancelReplyFails(), GameRegistry(), hub, GameRooms())

    async def create_then_cancel() -> None:
        await session.handle(create_message())
        hub.subscribe(watcher)
        with pytest.raises(RuntimeError):
            await session.handle({"type": "cancel_game"})

    asyncio.run(create_then_cancel())

    assert listed_names(watcher.sent) == [[]]


def join_message(**overrides: Any) -> dict[str, Any]:
    message: dict[str, Any] = {
        "type": "join_game",
        "gameName": "Partida 1",
        "username": "Ana",
        "color": "blue",
    }
    message.update(overrides)
    return message


ALREADY_IN_GAME = {"type": "error", "code": "already_in_game"}


def test_a_connection_is_in_at_most_one_game(
    client: TestClient, registry: GameRegistry
) -> None:
    with (
        client.websocket_connect("/api/ws") as host,
        client.websocket_connect("/api/ws") as player,
    ):
        request(host, create_message(maxPlayers=3))
        request(player, join_message())
        pending_messages(host)  # the roster update

        assert request(player, create_message(gameName="Duel")) == [ALREADY_IN_GAME]
        assert request(player, join_message()) == [ALREADY_IN_GAME]
        assert request(host, join_message(gameName="Duel")) == [ALREADY_IN_GAME]
        assert [game.name for game in registry.list()] == ["Partida 1"]


HOST = ("Esteban", "red")
ANA = ("Ana", "blue")
LUIS = ("Luis", "green")


def partida(*players: tuple[str, str], max_players: int = 3) -> dict[str, Any]:
    """The summary of the game made by `create_message(maxPlayers=max_players)`."""
    return {
        "name": "Partida 1",
        "maxPlayers": max_players,
        "boardWidth": 12,
        "boardHeight": 10,
        "timer": "none",
        "status": "waiting",
        "players": [{"name": name, "color": color} for name, color in players],
    }


def listing(*games: dict[str, Any]) -> dict[str, Any]:
    return {"type": "games_list", "games": list(games)}


def test_joining_updates_the_joiner_the_room_and_the_lobby(
    client: TestClient,
) -> None:
    with (
        client.websocket_connect("/api/ws") as host,
        client.websocket_connect("/api/ws") as watcher,
        client.websocket_connect("/api/ws") as ana,
        client.websocket_connect("/api/ws") as luis,
    ):
        request(host, create_message(maxPlayers=4))
        subscribe(watcher)

        replies = request(ana, join_message(gameName=" partida 1 "))

        assert replies == [{"type": "game_joined", "game": partida(HOST, ANA, max_players=4)}]
        assert pending_messages(host) == [
            {"type": "game_updated", "game": partida(HOST, ANA, max_players=4)}
        ]
        assert pending_messages(watcher) == [listing(partida(HOST, ANA, max_players=4))]

        request(luis, join_message(username="Luis", color="green"))

        updated = {"type": "game_updated", "game": partida(HOST, ANA, LUIS, max_players=4)}
        assert pending_messages(host) == [updated]
        assert pending_messages(ana) == [updated]


def test_subscribed_joiner_is_confirmed_before_receiving_the_new_list(
    client: TestClient,
) -> None:
    with (
        client.websocket_connect("/api/ws") as host,
        client.websocket_connect("/api/ws") as ana,
    ):
        request(host, create_message(maxPlayers=3))
        subscribe(ana)

        replies = request(ana, join_message())

        assert [reply["type"] for reply in replies] == ["game_joined", "games_list"]


@pytest.mark.parametrize(
    ("overrides", "field", "code"),
    [
        ({"username": "Al"}, "username", "invalid_username"),
        ({"color": "pink"}, "color", "invalid_color"),
        ({"gameName": "Ghost"}, "gameName", "game_not_found"),
        ({"gameName": None}, "gameName", "game_not_found"),
        ({"gameName": "Full house"}, "gameName", "game_in_progress"),
        ({"username": "esteban"}, "username", "username_taken"),
        ({"color": "red"}, "color", "color_taken"),
        ({"username": "Esteban", "color": "red"}, "username", "username_taken"),
        ({"username": "Al", "gameName": "Ghost"}, "username", "invalid_username"),
    ],
)
def test_rejected_join_reports_one_error_and_changes_nothing(
    client: TestClient,
    registry: GameRegistry,
    overrides: dict[str, Any],
    field: str,
    code: str,
) -> None:
    with (
        client.websocket_connect("/api/ws") as host,
        client.websocket_connect("/api/ws") as full_host,
        client.websocket_connect("/api/ws") as filler,
        client.websocket_connect("/api/ws") as watcher,
        client.websocket_connect("/api/ws") as joiner,
    ):
        request(host, create_message(maxPlayers=3))
        request(full_host, create_message(gameName="Full house"))
        request(filler, join_message(gameName="Full house"))
        pending_messages(full_host)
        subscribe(watcher)

        replies = request(joiner, join_message(**overrides))

        assert replies == [{"type": "error", "field": field, "code": code}]
        assert pending_messages(host) == []
        assert pending_messages(watcher) == []
        assert [len(game.players) for game in registry.list()] == [1, 2]
        # The socket stays usable.
        assert request(joiner, join_message())[0]["type"] == "game_joined"


def test_name_and_color_can_be_reused_in_another_game(client: TestClient) -> None:
    with (
        client.websocket_connect("/api/ws") as other_host,
        client.websocket_connect("/api/ws") as joiner,
    ):
        request(
            other_host,
            create_message(gameName="Duel", username="Luis", color="green"),
        )

        replies = request(
            joiner, join_message(gameName="Duel", username="Esteban", color="red")
        )

        assert replies[0]["type"] == "game_joined"


class YieldingSocket(RecordingSocket):
    """Gives other tasks a turn on every send, as a real socket can."""

    async def send_json(self, message: Any) -> None:
        await asyncio.sleep(0)
        await super().send_json(message)


def test_two_joins_racing_for_the_last_seat_admit_only_one() -> None:
    registry, hub, rooms = GameRegistry(), LobbyHub(), GameRooms()
    sockets = [YieldingSocket() for _ in range(3)]
    host, ana, luis = (
        ClientSession(socket, registry, hub, rooms) for socket in sockets
    )

    async def race() -> None:
        await host.handle(create_message(maxPlayers=2))
        await asyncio.gather(
            ana.handle(join_message()),
            luis.handle(join_message(username="Luis", color="green")),
        )

    asyncio.run(race())

    first_replies = [socket.sent[0] for socket in sockets[1:]]
    assert sorted(reply["type"] for reply in first_replies) == [
        "error",
        "game_joined",
    ]
    assert [r["code"] for r in first_replies if r["type"] == "error"] == [
        "game_in_progress"
    ]
    assert len(registry.list()[0].players) == 2


LEAVE = {"type": "leave_game"}
GAME_LEFT = {"type": "game_left"}


def test_leaving_removes_the_player_and_updates_the_room_and_the_lobby(
    client: TestClient,
) -> None:
    with (
        client.websocket_connect("/api/ws") as host,
        client.websocket_connect("/api/ws") as watcher,
        client.websocket_connect("/api/ws") as ana,
    ):
        request(host, create_message(maxPlayers=3))
        request(ana, join_message())
        pending_messages(host)
        subscribe(watcher)

        assert request(ana, LEAVE) == [GAME_LEFT]

        assert pending_messages(host) == [
            {"type": "game_updated", "game": partida(HOST)}
        ]
        assert pending_messages(watcher) == [listing(partida(HOST))]
        # The same socket can join again, with the freed name and color.
        assert request(ana, join_message()) == [
            {"type": "game_joined", "game": partida(HOST, ANA)}
        ]


def test_name_and_color_of_a_player_who_left_can_be_reused(
    client: TestClient,
) -> None:
    with (
        client.websocket_connect("/api/ws") as host,
        client.websocket_connect("/api/ws") as ana,
        client.websocket_connect("/api/ws") as other,
    ):
        request(host, create_message(maxPlayers=3))
        request(ana, join_message())
        request(ana, LEAVE)

        assert request(other, join_message())[0]["type"] == "game_joined"


def disconnect(socket: WebSocketTestSession) -> None:
    """Close the socket but let the server finish handling it.

    Leaving the socket's `with` block would cancel the server task instead, which
    cuts its cleanup short in a way a real server does not.
    """
    socket.close()


def test_player_disconnect_updates_the_room_and_the_lobby(
    client: TestClient,
) -> None:
    with (
        client.websocket_connect("/api/ws") as host,
        client.websocket_connect("/api/ws") as watcher,
        client.websocket_connect("/api/ws") as ana,
    ):
        request(host, create_message(maxPlayers=3))
        request(ana, join_message())
        pending_messages(host)
        subscribe(watcher)

        disconnect(ana)

        assert pending_messages(host) == [
            {"type": "game_updated", "game": partida(HOST)}
        ]
        assert pending_messages(watcher) == [listing(partida(HOST))]


def test_host_sending_leave_game_changes_nothing(
    client: TestClient, registry: GameRegistry
) -> None:
    with (
        client.websocket_connect("/api/ws") as host,
        client.websocket_connect("/api/ws") as watcher,
    ):
        request(host, create_message())
        subscribe(watcher)

        assert request(host, LEAVE) == [GAME_LEFT]
        assert pending_messages(watcher) == []
        assert [len(game.players) for game in registry.list()] == [1]
        assert request(host, create_message(gameName="Duel")) == [ALREADY_IN_GAME]


def test_leave_without_a_game_is_only_confirmed(client: TestClient) -> None:
    with (
        client.websocket_connect("/api/ws") as watcher,
        client.websocket_connect("/api/ws") as other,
    ):
        subscribe(watcher)

        assert request(other, LEAVE) == [GAME_LEFT]
        assert pending_messages(watcher) == []


class LeaveReplyFails:
    async def send_json(self, message: dict[str, Any]) -> None:
        if message["type"] == "game_left":
            raise RuntimeError("connection is gone")


def test_leave_updates_the_others_even_if_the_leaver_is_gone() -> None:
    registry, hub, rooms = GameRegistry(), LobbyHub(), GameRooms()
    host_socket, watcher = RecordingSocket(), RecordingSocket()
    host = ClientSession(host_socket, registry, hub, rooms)
    ana = ClientSession(LeaveReplyFails(), registry, hub, rooms)

    async def join_then_leave() -> None:
        await host.handle(create_message(maxPlayers=3))
        await ana.handle(join_message())
        hub.subscribe(watcher)
        host_socket.sent.clear()
        with pytest.raises(RuntimeError):
            await ana.handle(LEAVE)

    asyncio.run(join_then_leave())

    assert host_socket.sent == [{"type": "game_updated", "game": partida(HOST)}]
    assert watcher.sent == [listing(partida(HOST))]


GAME_CLOSED = {"type": "game_closed"}
GAME_CANCELLED = {"type": "game_cancelled"}


def assert_free_after_game_closed(player: WebSocketTestSession) -> None:
    assert request(player, LEAVE) == [GAME_LEFT]
    assert request(player, join_message(gameName="Ghost"))[0]["code"] == (
        "game_not_found"
    )
    assert request(player, create_message())[0]["type"] == "game_created"


def test_host_cancel_closes_the_game_for_its_players(
    client: TestClient, registry: GameRegistry
) -> None:
    with (
        client.websocket_connect("/api/ws") as host,
        client.websocket_connect("/api/ws") as watcher,
        client.websocket_connect("/api/ws") as ana,
    ):
        request(host, create_message(maxPlayers=3))
        request(ana, join_message())
        pending_messages(host)
        subscribe(watcher)

        assert request(host, {"type": "cancel_game"}) == [GAME_CANCELLED]

        assert pending_messages(ana) == [GAME_CLOSED]
        assert pending_messages(watcher) == [listing()]
        assert_free_after_game_closed(ana)


def test_host_disconnect_closes_the_game_for_its_players(
    client: TestClient,
) -> None:
    with (
        client.websocket_connect("/api/ws") as host,
        client.websocket_connect("/api/ws") as watcher,
        client.websocket_connect("/api/ws") as ana,
    ):
        request(host, create_message(maxPlayers=3))
        request(ana, join_message())
        subscribe(watcher)

        disconnect(host)

        assert pending_messages(ana) == [GAME_CLOSED]
        assert pending_messages(watcher) == [listing()]
        assert_free_after_game_closed(ana)


def test_player_sending_cancel_game_leaves_the_game_intact(
    client: TestClient, registry: GameRegistry
) -> None:
    with (
        client.websocket_connect("/api/ws") as host,
        client.websocket_connect("/api/ws") as ana,
    ):
        request(host, create_message(maxPlayers=3))
        request(ana, join_message())
        pending_messages(host)

        assert request(ana, {"type": "cancel_game"}) == [GAME_CANCELLED]
        assert pending_messages(host) == []
        assert [len(game.players) for game in registry.list()] == [2]
        assert request(ana, create_message(gameName="Duel")) == [ALREADY_IN_GAME]


class GameClosedFails:
    async def send_json(self, message: dict[str, Any]) -> None:
        if message["type"] == "game_closed":
            raise RuntimeError("connection is gone")


def test_player_who_cannot_be_told_does_not_stop_the_others() -> None:
    registry, hub, rooms = GameRegistry(), LobbyHub(), GameRooms()
    watcher, luis_socket = RecordingSocket(), RecordingSocket()
    host, ana, luis = (
        ClientSession(socket, registry, hub, rooms)
        for socket in (RecordingSocket(), GameClosedFails(), luis_socket)
    )

    async def join_then_cancel() -> None:
        await host.handle(create_message(maxPlayers=4))
        await ana.handle(join_message())
        await luis.handle(join_message(username="Luis", color="green"))
        hub.subscribe(watcher)
        await host.handle({"type": "cancel_game"})

    asyncio.run(join_then_cancel())

    assert luis_socket.sent[-1] == GAME_CLOSED
    assert watcher.sent == [listing()]


def empty_state(*order: str) -> dict[str, Any]:
    """The state of a 12 x 10 game that has just started."""
    return {
        "board": [[None] * 12 for _ in range(10)],
        "turnOrder": list(order),
        "currentPlayer": order[0],
        "phase": "mark",
        "scores": dict.fromkeys(order, 0),
        "leftPlayers": [],
        "lastMove": None,
        "endProposalsLeft": dict.fromkeys(order, 2),
        "vote": None,
        "timer": "none",
        "clocks": None,
        "chooseMsLeft": None,
    }


def types_of(messages: list[Any]) -> list[str]:
    return [message["type"] for message in messages]


def test_taking_the_last_seat_starts_the_game(client: TestClient) -> None:
    with (
        client.websocket_connect("/api/ws") as host,
        client.websocket_connect("/api/ws") as watcher,
        client.websocket_connect("/api/ws") as ana,
    ):
        request(host, create_message())
        subscribe(watcher)

        joiner_replies = request(ana, join_message())
        host_messages = pending_messages(host)

        assert types_of(joiner_replies) == ["game_joined", "game_started"]
        assert types_of(host_messages) == ["game_updated", "game_started"]
        started = {"type": "game_started", "state": empty_state("Ana", "Esteban")}
        assert joiner_replies[1] == started
        assert host_messages[1] == started
        (listed,) = pending_messages(watcher)
        assert [game["status"] for game in listed["games"]] == ["playing"]


def test_a_game_with_room_does_not_start(client: TestClient) -> None:
    with (
        client.websocket_connect("/api/ws") as host,
        client.websocket_connect("/api/ws") as ana,
    ):
        request(host, create_message(maxPlayers=3))

        assert types_of(request(ana, join_message())) == ["game_joined"]
        assert types_of(pending_messages(host)) == ["game_updated"]


@pytest.mark.parametrize(
    "overrides",
    [{}, {"username": "Esteban"}, {"color": "red"}],
)
def test_a_game_in_progress_cannot_be_joined(
    client: TestClient, registry: GameRegistry, overrides: dict[str, Any]
) -> None:
    with (
        client.websocket_connect("/api/ws") as host,
        client.websocket_connect("/api/ws") as ana,
        client.websocket_connect("/api/ws") as watcher,
        client.websocket_connect("/api/ws") as late,
    ):
        request(host, create_message())
        request(ana, join_message())
        subscribe(watcher)

        message = join_message(**{"username": "Luis", "color": "green"} | overrides)

        assert request(late, message) == [
            {"type": "error", "field": "gameName", "code": "game_in_progress"}
        ]
        assert pending_messages(watcher) == []
        assert [len(game.players) for game in registry.list()] == [2]


def test_the_timer_mode_is_sent_in_every_summary(client: TestClient) -> None:
    with (
        client.websocket_connect("/api/ws") as host,
        client.websocket_connect("/api/ws") as watcher,
        client.websocket_connect("/api/ws") as ana,
    ):
        subscribe(watcher)

        (created,) = request(host, create_message(timer="normal"))
        (listed,) = pending_messages(watcher)
        joined = request(ana, join_message())[0]
        updated = pending_messages(host)[0]

        assert (created["type"], created["game"]["timer"]) == ("game_created", "normal")
        assert [game["timer"] for game in listed["games"]] == ["normal"]
        assert (joined["type"], joined["game"]["timer"]) == ("game_joined", "normal")
        assert (updated["type"], updated["game"]["timer"]) == ("game_updated", "normal")


def test_an_unknown_timer_is_rejected_and_the_lobby_hears_nothing(
    client: TestClient, registry: GameRegistry
) -> None:
    with (
        client.websocket_connect("/api/ws") as host,
        client.websocket_connect("/api/ws") as watcher,
    ):
        subscribe(watcher)

        assert request(host, create_message(timer="blitz")) == [
            {"type": "error", "field": "timer", "code": "invalid_timer"}
        ]
        assert pending_messages(watcher) == []
        assert registry.list() == []


def mark(row: object, col: object) -> dict[str, Any]:
    return {"type": "mark_cell", "row": row, "col": col}


def start_duel(
    host: WebSocketTestSession, ana: WebSocketTestSession, **settings: Any
) -> None:
    """Start a two-player game, where "Ana" moves first, and read its messages."""
    request(host, create_message(**settings))
    request(ana, join_message())
    pending_messages(host)


def only_state(socket: WebSocketTestSession) -> dict[str, Any]:
    (message,) = pending_messages(socket)
    assert message["type"] == "game_state"
    return message["state"]


def make_move(
    mover: WebSocketTestSession,
    others: list[WebSocketTestSession],
    message: dict[str, Any],
) -> None:
    """Make an accepted move and read the state each player receives."""
    mover.send_json(message)
    for socket in (mover, *others):
        only_state(socket)


def play(
    first: WebSocketTestSession,
    second: WebSocketTestSession,
    first_cells: list[tuple[int, int]],
    second_cells: list[tuple[int, int]],
) -> None:
    """Let two players mark in turns."""
    for first_cell, second_cell in zip(first_cells, second_cells, strict=True):
        make_move(first, [second], mark(*first_cell))
        make_move(second, [first], mark(*second_cell))


def prepare_two_us(host: WebSocketTestSession, ana: WebSocketTestSession) -> None:
    """Leave "Ana" one mark, at (1, 2), away from completing two Us."""
    start_duel(host, ana)
    play(
        ana,
        host,
        [(0, 0), (0, 2), (0, 4), (1, 0), (1, 1), (1, 3), (1, 4)],
        # A single row can never form a U.
        [(9, col) for col in range(7)],
    )


def test_a_mark_is_sent_to_every_player(client: TestClient) -> None:
    with (
        client.websocket_connect("/api/ws") as host,
        client.websocket_connect("/api/ws") as ana,
        client.websocket_connect("/api/ws") as watcher,
    ):
        start_duel(host, ana)
        subscribe(watcher)

        ana.send_json(mark(2, 3))

        for socket in (ana, host):
            state = only_state(socket)
            assert state["board"][2][3] == {"owner": "Ana", "disabled": False}
            assert state["currentPlayer"] == "Esteban"
            assert state["lastMove"] == {"row": 2, "col": 3}
        assert pending_messages(watcher) == []


def test_only_the_chooser_receives_the_candidates(client: TestClient) -> None:
    with (
        client.websocket_connect("/api/ws") as host,
        client.websocket_connect("/api/ws") as ana,
    ):
        prepare_two_us(host, ana)

        ana.send_json(mark(1, 2))

        chooser, other = only_state(ana), only_state(host)
        assert chooser["phase"] == other["phase"] == "choose"
        assert len(chooser["candidates"]) == 2
        assert "candidates" not in other


@pytest.mark.parametrize(
    ("sender", "message", "code"),
    [
        ("host", mark(0, 0), "not_your_turn"),
        ("ana", mark(10, 0), "cell_out_of_bounds"),
        ("ana", {"type": "mark_cell"}, "cell_out_of_bounds"),
        ("ana", mark(9, 0), "cell_taken"),
    ],
)
def test_a_rejected_mark_is_only_reported_to_its_sender(
    client: TestClient, sender: str, message: dict[str, Any], code: str
) -> None:
    with (
        client.websocket_connect("/api/ws") as host,
        client.websocket_connect("/api/ws") as ana,
    ):
        start_duel(host, ana)
        play(ana, host, [(0, 0)], [(9, 0)])
        sockets = {"host": host, "ana": ana}

        assert request(sockets.pop(sender), message) == [
            {"type": "error", "code": code}
        ]
        (other,) = sockets.values()
        assert pending_messages(other) == []


def test_a_mark_during_a_choice_is_rejected_over_the_socket(
    client: TestClient,
) -> None:
    with (
        client.websocket_connect("/api/ws") as host,
        client.websocket_connect("/api/ws") as ana,
    ):
        prepare_two_us(host, ana)
        make_move(ana, [host], mark(1, 2))

        assert request(ana, mark(5, 5)) == [
            {"type": "error", "code": "choice_pending"}
        ]
        assert pending_messages(host) == []


NOT_STARTED = {"type": "error", "code": "game_not_started"}


def assert_not_started(client: TestClient, message: dict[str, Any]) -> None:
    """The move is rejected in a waiting room and outside any game."""
    with (
        client.websocket_connect("/api/ws") as host,
        client.websocket_connect("/api/ws") as ana,
        client.websocket_connect("/api/ws") as stranger,
    ):
        request(host, create_message(maxPlayers=3))
        request(ana, join_message())
        pending_messages(host)

        for socket in (host, ana, stranger):
            assert request(socket, message) == [NOT_STARTED]


def test_a_mark_without_a_started_game_is_rejected(client: TestClient) -> None:
    assert_not_started(client, mark(0, 0))


class StallingSocket(RecordingSocket):
    """Holds back its first `game_state` until it is released."""

    held_type = "game_state"

    def __init__(self) -> None:
        super().__init__()
        self.stalled = asyncio.Event()
        self.release = asyncio.Event()

    async def send_json(self, message: Any) -> None:
        if message["type"] == self.held_type and not self.stalled.is_set():
            self.stalled.set()
            await self.release.wait()
        await super().send_json(message)


def current_players(socket: RecordingSocket) -> list[str]:
    return [
        message["state"]["currentPlayer"]
        for message in socket.sent
        if message["type"] == "game_state"
    ]


def test_a_slow_connection_does_not_reorder_the_states_of_the_others() -> None:
    async def scenario() -> list[str]:
        registry, hub, rooms = GameRegistry(), LobbyHub(), GameRooms()
        slow, last = StallingSocket(), RecordingSocket()
        # "Ana" is served between the host and "Luis", who is served last.
        host, ana, luis = (
            ClientSession(socket, registry, hub, rooms, TURN_ORDER)
            for socket in (RecordingSocket(), slow, last)
        )
        await host.handle(create_message(maxPlayers=3))
        await ana.handle(join_message())
        await luis.handle(join_message(username="Luis", color="green"))

        # The turn order is Ana, Esteban, Luis.
        first = asyncio.create_task(ana.handle(mark(0, 0)))
        await asyncio.wait_for(slow.stalled.wait(), timeout=5)
        second = asyncio.create_task(host.handle(mark(5, 5)))
        for _ in range(10):
            await asyncio.sleep(0)
        slow.release.set()
        await asyncio.wait_for(asyncio.gather(first, second), timeout=5)
        return current_players(last)

    assert asyncio.run(scenario()) == ["Esteban", "Luis"]


def choose(index: object) -> dict[str, Any]:
    return {"type": "choose_u", "index": index}


def test_a_choice_is_sent_to_every_player(client: TestClient) -> None:
    with (
        client.websocket_connect("/api/ws") as host,
        client.websocket_connect("/api/ws") as ana,
    ):
        prepare_two_us(host, ana)
        make_move(ana, [host], mark(1, 2))

        ana.send_json(choose(1))

        for socket in (ana, host):
            state = only_state(socket)
            assert state["scores"] == {"Ana": 1, "Esteban": 0}
            assert (state["phase"], state["currentPlayer"]) == ("mark", "Esteban")


@pytest.mark.parametrize(
    ("choosing", "sender", "message", "code"),
    [
        (False, "ana", choose(0), "no_choice_pending"),
        (True, "ana", choose(2), "invalid_choice"),
        (True, "ana", {"type": "choose_u"}, "invalid_choice"),
        (True, "host", choose(0), "not_your_turn"),
    ],
)
def test_a_rejected_choice_is_only_reported_to_its_sender(
    client: TestClient,
    choosing: bool,
    sender: str,
    message: dict[str, Any],
    code: str,
) -> None:
    with (
        client.websocket_connect("/api/ws") as host,
        client.websocket_connect("/api/ws") as ana,
    ):
        prepare_two_us(host, ana)
        if choosing:
            make_move(ana, [host], mark(1, 2))
        sockets = {"host": host, "ana": ana}

        assert request(sockets.pop(sender), message) == [
            {"type": "error", "code": code}
        ]
        (other,) = sockets.values()
        assert pending_messages(other) == []


def test_a_choice_without_a_started_game_is_rejected(client: TestClient) -> None:
    assert_not_started(client, choose(0))


LUIS_JOINS = {"username": "Luis", "color": "green"}


def start_trio(
    host: WebSocketTestSession,
    ana: WebSocketTestSession,
    luis: WebSocketTestSession,
) -> None:
    """Start a three-player game. The turn order is Ana, Esteban, Luis."""
    request(host, create_message(maxPlayers=3))
    request(ana, join_message())
    request(luis, join_message(**LUIS_JOINS))
    for socket in (host, ana):
        pending_messages(socket)


def test_leaving_during_play_updates_the_others_and_the_lobby(
    client: TestClient,
) -> None:
    with (
        client.websocket_connect("/api/ws") as host,
        client.websocket_connect("/api/ws") as ana,
        client.websocket_connect("/api/ws") as luis,
        client.websocket_connect("/api/ws") as watcher,
    ):
        start_trio(host, ana, luis)
        subscribe(watcher)

        assert request(luis, LEAVE) == [GAME_LEFT]

        for socket in (host, ana):
            assert only_state(socket)["leftPlayers"] == ["Luis"]
        assert pending_messages(watcher) == [
            listing(partida(HOST, ANA) | {"status": "playing"})
        ]
        # The one who left is no longer in any game.
        assert request(luis, mark(0, 0)) == [NOT_STARTED]
        assert request(luis, create_message(gameName="Duel"))[0]["type"] == (
            "game_created"
        )


def test_a_subscribed_leaver_is_confirmed_before_the_new_list(
    client: TestClient,
) -> None:
    with (
        client.websocket_connect("/api/ws") as host,
        client.websocket_connect("/api/ws") as ana,
        client.websocket_connect("/api/ws") as luis,
    ):
        start_trio(host, ana, luis)
        subscribe(luis)

        assert types_of(request(luis, LEAVE)) == ["game_left", "games_list"]


def test_the_host_disconnecting_during_play_does_not_close_the_game(
    client: TestClient, registry: GameRegistry
) -> None:
    with (
        client.websocket_connect("/api/ws") as host,
        client.websocket_connect("/api/ws") as ana,
        client.websocket_connect("/api/ws") as luis,
        client.websocket_connect("/api/ws") as watcher,
    ):
        start_trio(host, ana, luis)
        subscribe(watcher)

        disconnect(host)

        # The only message is the state: no `game_closed`.
        for socket in (ana, luis):
            assert only_state(socket)["leftPlayers"] == ["Esteban"]
        assert pending_messages(watcher) == [
            listing(partida(ANA, LUIS) | {"status": "playing"})
        ]
        assert [game.name for game in registry.list()] == ["Partida 1"]
        make_move(ana, [luis], mark(0, 0))


def test_the_host_cancelling_during_play_changes_nothing(
    client: TestClient,
) -> None:
    with (
        client.websocket_connect("/api/ws") as host,
        client.websocket_connect("/api/ws") as ana,
        client.websocket_connect("/api/ws") as watcher,
    ):
        start_duel(host, ana)
        subscribe(watcher)

        assert request(host, {"type": "cancel_game"}) == [GAME_CANCELLED]

        assert pending_messages(ana) == []
        assert pending_messages(watcher) == []
        # The host is still playing.
        assert request(host, create_message(gameName="Duel")) == [ALREADY_IN_GAME]
        make_move(ana, [host], mark(0, 0))
        make_move(host, [ana], mark(0, 1))


def test_a_player_who_left_can_join_another_game(client: TestClient) -> None:
    with (
        client.websocket_connect("/api/ws") as host,
        client.websocket_connect("/api/ws") as ana,
        client.websocket_connect("/api/ws") as luis,
        client.websocket_connect("/api/ws") as other_host,
    ):
        start_trio(host, ana, luis)
        request(host, LEAVE)
        request(other_host, create_message(gameName="Duel", maxPlayers=3))

        assert request(host, join_message(gameName="Duel"))[0]["type"] == (
            "game_joined"
        )


def test_the_turn_passes_when_its_player_leaves_during_play(
    client: TestClient,
) -> None:
    with (
        client.websocket_connect("/api/ws") as host,
        client.websocket_connect("/api/ws") as ana,
        client.websocket_connect("/api/ws") as luis,
    ):
        start_trio(host, ana, luis)

        request(ana, LEAVE)

        for socket in (host, luis):
            assert only_state(socket)["currentPlayer"] == "Esteban"


def test_a_choice_is_dropped_when_its_player_disconnects(
    client: TestClient,
) -> None:
    with (
        client.websocket_connect("/api/ws") as host,
        client.websocket_connect("/api/ws") as ana,
        client.websocket_connect("/api/ws") as luis,
    ):
        start_trio(host, ana, luis)
        cells = [(0, 0), (0, 2), (0, 4), (1, 0), (1, 1), (1, 3), (1, 4)]
        for col, cell in enumerate(cells):
            make_move(ana, [host, luis], mark(*cell))
            # Single rows can never form a U.
            make_move(host, [ana, luis], mark(9, col))
            make_move(luis, [ana, host], mark(7, col))
        make_move(ana, [host, luis], mark(1, 2))

        disconnect(ana)

        for socket in (host, luis):
            state = only_state(socket)
            assert (state["phase"], state["currentPlayer"]) == ("mark", "Esteban")
            assert state["scores"]["Ana"] == 0
            assert not any(cell and cell["disabled"] for cell in sum(state["board"], []))


def leave_one_cell_empty(registry: GameRegistry, scores: dict[str, int]) -> None:
    """Fill the board of the only game, except its last cell, and set the scores."""
    match = registry.list()[0].match
    # Disabled cells take no part in any U.
    match.board = [[Cell("Esteban", disabled=True)] * 12 for _ in range(10)]
    match.board[9][11] = None
    match.scores.update(scores)


def assert_free_after_game_over(
    client: TestClient, player: WebSocketTestSession
) -> None:
    assert request(player, mark(0, 0)) == [NOT_STARTED]
    assert request(player, create_message(maxPlayers=3))[0]["type"] == "game_created"


def test_filling_the_board_ends_and_removes_the_game(
    client: TestClient, registry: GameRegistry
) -> None:
    with (
        client.websocket_connect("/api/ws") as host,
        client.websocket_connect("/api/ws") as ana,
        client.websocket_connect("/api/ws") as watcher,
    ):
        start_duel(host, ana)
        leave_one_cell_empty(registry, {"Esteban": 4, "Ana": 2})
        subscribe(watcher)

        ana_messages = request(ana, mark(9, 11))
        host_messages = pending_messages(host)

        # The last move is reported like any other, then the end.
        for messages in (ana_messages, host_messages):
            assert types_of(messages) == ["game_state", "game_over"]
        over = host_messages[1]
        assert over == ana_messages[1]
        assert over["winners"] == ["Esteban"]
        assert over["reason"] == "board_full"
        assert over["scores"] == {"Esteban": 4, "Ana": 2}
        assert over["board"] == host_messages[0]["state"]["board"]
        assert registry.list() == []
        assert pending_messages(watcher) == [listing()]
        # The name can be used again, and both players are free.
        assert_free_after_game_over(client, ana)
        assert request(host, join_message(username="Pia", color="green"))[0][
            "type"
        ] == "game_joined"


@pytest.mark.parametrize("disconnects", [False, True])
def test_the_last_player_left_wins_and_the_game_is_removed(
    client: TestClient, registry: GameRegistry, disconnects: bool
) -> None:
    with (
        client.websocket_connect("/api/ws") as host,
        client.websocket_connect("/api/ws") as ana,
        client.websocket_connect("/api/ws") as watcher,
    ):
        start_duel(host, ana)
        subscribe(watcher)

        if disconnects:
            disconnect(ana)
        else:
            assert request(ana, LEAVE) == [GAME_LEFT]

        (over,) = pending_messages(host)
        assert over["type"] == "game_over"
        assert (over["winners"], over["reason"]) == (["Esteban"], "last_player")
        assert registry.list() == []
        assert pending_messages(watcher) == [listing()]
        assert_free_after_game_over(client, host)


def test_the_configured_vote_duration_reaches_the_match(
    client: TestClient, registry: GameRegistry
) -> None:
    app.dependency_overrides[get_vote_seconds] = lambda: 5
    with (
        client.websocket_connect("/api/ws") as host,
        client.websocket_connect("/api/ws") as ana,
    ):
        start_duel(host, ana)

        assert registry.list()[0].match.vote_seconds == 5


def test_a_vote_lasts_thirty_seconds_by_default() -> None:
    assert get_vote_seconds() == 30


PROPOSE = {"type": "propose_end"}


def vote_end(end: object) -> dict[str, Any]:
    return {"type": "vote_end", "end": end}


def test_a_proposal_sends_the_open_vote_to_every_player(
    client: TestClient,
) -> None:
    with (
        client.websocket_connect("/api/ws") as host,
        client.websocket_connect("/api/ws") as ana,
        client.websocket_connect("/api/ws") as watcher,
    ):
        start_duel(host, ana)
        subscribe(watcher)

        ana.send_json(PROPOSE)

        for socket, own_vote in ((ana, "end"), (host, None)):
            vote = only_state(socket)["vote"]
            assert (vote["proposer"], vote["voted"], vote["total"]) == ("Ana", 1, 2)
            assert vote["yourVote"] == own_vote
        assert pending_messages(watcher) == []


def test_a_vote_that_stays_open_is_sent_to_every_player(
    client: TestClient,
) -> None:
    with (
        client.websocket_connect("/api/ws") as host,
        client.websocket_connect("/api/ws") as ana,
        client.websocket_connect("/api/ws") as luis,
    ):
        start_trio(host, ana, luis)
        make_move(ana, [host, luis], PROPOSE)

        luis.send_json(vote_end(False))

        for socket in (host, ana, luis):
            vote = only_state(socket)["vote"]
            assert (vote["voted"], vote["total"]) == (2, 3)


@pytest.mark.parametrize(
    ("proposed", "sender", "message", "code"),
    [
        (False, "host", PROPOSE, "not_your_turn"),
        (True, "ana", PROPOSE, "vote_pending"),
        (True, "ana", mark(0, 0), "vote_pending"),
        (True, "ana", choose(0), "vote_pending"),
        (False, "host", vote_end(True), "no_vote_pending"),
        (True, "ana", vote_end(False), "proposer_cannot_vote"),
        (True, "host", vote_end("yes"), "invalid_vote"),
        (True, "host", {"type": "vote_end"}, "invalid_vote"),
    ],
)
def test_a_rejected_vote_message_is_only_reported_to_its_sender(
    client: TestClient,
    proposed: bool,
    sender: str,
    message: dict[str, Any],
    code: str,
) -> None:
    with (
        client.websocket_connect("/api/ws") as host,
        client.websocket_connect("/api/ws") as ana,
    ):
        start_duel(host, ana)
        if proposed:
            make_move(ana, [host], PROPOSE)
        sockets = {"host": host, "ana": ana}

        assert request(sockets.pop(sender), message) == [
            {"type": "error", "code": code}
        ]
        (other,) = sockets.values()
        assert pending_messages(other) == []


def test_a_second_vote_is_rejected_over_the_socket(client: TestClient) -> None:
    with (
        client.websocket_connect("/api/ws") as host,
        client.websocket_connect("/api/ws") as ana,
        client.websocket_connect("/api/ws") as luis,
    ):
        start_trio(host, ana, luis)
        make_move(ana, [host, luis], PROPOSE)
        make_move(luis, [host, ana], vote_end(False))

        assert request(luis, vote_end(True)) == [
            {"type": "error", "code": "already_voted"}
        ]
        assert pending_messages(host) == []


def test_a_proposal_during_a_choice_is_rejected_over_the_socket(
    client: TestClient,
) -> None:
    with (
        client.websocket_connect("/api/ws") as host,
        client.websocket_connect("/api/ws") as ana,
    ):
        prepare_two_us(host, ana)
        make_move(ana, [host], mark(1, 2))

        assert request(ana, PROPOSE) == [{"type": "error", "code": "choice_pending"}]
        assert pending_messages(host) == []


def test_a_proposal_without_attempts_is_rejected_over_the_socket(
    client: TestClient, registry: GameRegistry
) -> None:
    with (
        client.websocket_connect("/api/ws") as host,
        client.websocket_connect("/api/ws") as ana,
    ):
        start_duel(host, ana)
        registry.list()[0].match.proposals_left["Ana"] = 0

        assert request(ana, PROPOSE) == [
            {"type": "error", "code": "no_proposals_left"}
        ]
        assert pending_messages(host) == []


@pytest.mark.parametrize("message", [PROPOSE, vote_end(True)])
def test_a_vote_message_without_a_started_game_is_rejected(
    client: TestClient, message: dict[str, Any]
) -> None:
    assert_not_started(client, message)


def assert_vote_failed(
    socket: WebSocketTestSession, proposer: str, end: int, keep: int
) -> dict[str, Any]:
    """The notice and then the state without a vote. Return that state."""
    failed, updated = pending_messages(socket)
    assert failed == {
        "type": "vote_failed",
        "proposer": proposer,
        "endVotes": end,
        "continueVotes": keep,
    }
    assert updated["type"] == "game_state"
    assert updated["state"]["vote"] is None
    return updated["state"]


def test_a_failed_vote_is_announced_and_the_turn_goes_on(
    client: TestClient,
) -> None:
    with (
        client.websocket_connect("/api/ws") as host,
        client.websocket_connect("/api/ws") as ana,
    ):
        start_duel(host, ana)
        make_move(ana, [host], PROPOSE)

        host.send_json(vote_end(False))

        for socket in (host, ana):
            state = assert_vote_failed(socket, "Ana", 1, 1)
            assert (state["currentPlayer"], state["phase"]) == ("Ana", "mark")
            assert state["endProposalsLeft"] == {"Ana": 1, "Esteban": 2}
        make_move(ana, [host], mark(0, 0))


def test_a_passed_vote_ends_and_removes_the_game(
    client: TestClient, registry: GameRegistry
) -> None:
    with (
        client.websocket_connect("/api/ws") as host,
        client.websocket_connect("/api/ws") as ana,
        client.websocket_connect("/api/ws") as watcher,
    ):
        start_duel(host, ana)
        make_move(ana, [host], PROPOSE)
        subscribe(watcher)

        host_messages = request(host, vote_end(True))
        ana_messages = pending_messages(ana)

        # No `game_state` comes first: there is no move to show.
        for messages in (host_messages, ana_messages):
            assert types_of(messages) == ["game_over"]
        assert host_messages == ana_messages
        assert host_messages[0]["reason"] == "vote"
        assert host_messages[0]["winners"] == ["Ana", "Esteban"]
        assert registry.list() == []
        assert pending_messages(watcher) == [listing()]
        assert_free_after_game_over(client, ana)


@pytest.mark.parametrize("disconnects", [False, True])
def test_a_leaving_voter_can_make_the_vote_fail_over_the_socket(
    client: TestClient, disconnects: bool
) -> None:
    with (
        client.websocket_connect("/api/ws") as host,
        client.websocket_connect("/api/ws") as ana,
        client.websocket_connect("/api/ws") as luis,
    ):
        start_trio(host, ana, luis)
        make_move(ana, [host, luis], PROPOSE)
        make_move(host, [ana, luis], vote_end(False))

        if disconnects:
            disconnect(luis)
        else:
            assert request(luis, LEAVE) == [GAME_LEFT]

        for socket in (host, ana):
            assert_vote_failed(socket, "Ana", 1, 1)


def test_a_leaving_voter_can_make_the_vote_pass_over_the_socket(
    client: TestClient, registry: GameRegistry
) -> None:
    order = FixedOrder("Ana", "Esteban", "Luis", "Pia")
    app.dependency_overrides[get_random] = lambda: order
    with (
        client.websocket_connect("/api/ws") as host,
        client.websocket_connect("/api/ws") as ana,
        client.websocket_connect("/api/ws") as luis,
        client.websocket_connect("/api/ws") as pia,
    ):
        request(host, create_message(maxPlayers=4))
        request(ana, join_message())
        request(luis, join_message(**LUIS_JOINS))
        request(pia, join_message(username="Pia", color="yellow"))
        for socket in (host, ana, luis):
            pending_messages(socket)
        make_move(ana, [host, luis, pia], PROPOSE)
        make_move(host, [ana, luis, pia], vote_end(True))
        make_move(luis, [ana, host, pia], vote_end(False))

        disconnect(luis)

        for socket in (ana, host, pia):
            (over,) = pending_messages(socket)
            assert (over["type"], over["reason"]) == ("game_over", "vote")
        assert registry.list() == []


def receive_types(socket: WebSocketTestSession, count: int) -> list[Any]:
    """Block until `count` messages arrive, so no test has to sleep."""
    return [socket.receive_json() for _ in range(count)]


def test_a_vote_nobody_answers_fails_when_time_runs_out(
    client: TestClient,
) -> None:
    app.dependency_overrides[get_vote_seconds] = lambda: 0.05
    with (
        client.websocket_connect("/api/ws") as host,
        client.websocket_connect("/api/ws") as ana,
        client.websocket_connect("/api/ws") as luis,
    ):
        start_trio(host, ana, luis)

        # Not read with a probe: the expiry could arrive before its reply.
        ana.send_json(PROPOSE)

        for socket in (host, ana, luis):
            opened, failed, updated = receive_types(socket, 3)
            assert opened["state"]["vote"]["proposer"] == "Ana"
            assert failed == {
                "type": "vote_failed",
                "proposer": "Ana",
                "endVotes": 1,
                "continueVotes": 2,
            }
            assert updated["type"] == "game_state"
            assert updated["state"]["vote"] is None


def test_the_proposer_keeps_the_turn_after_the_vote_expires(
    client: TestClient,
) -> None:
    app.dependency_overrides[get_vote_seconds] = lambda: 0.05
    with (
        client.websocket_connect("/api/ws") as host,
        client.websocket_connect("/api/ws") as ana,
    ):
        start_duel(host, ana)
        ana.send_json(PROPOSE)
        for socket in (host, ana):
            state = receive_types(socket, 3)[-1]["state"]
            assert (state["currentPlayer"], state["phase"]) == ("Ana", "mark")
            assert state["endProposalsLeft"] == {"Ana": 1, "Esteban": 2}

        make_move(ana, [host], mark(0, 0))


class Trio:
    """A three-player game driven without a server. "Ana" moves first."""

    # The timer mode the game is created with.
    timer = "none"

    def __init__(
        self,
        ana_socket: RecordingSocket | None = None,
        vote_seconds: float = 30,
        timer_modes: dict[TimerMode, TimerSettings] | None = None,
    ) -> None:
        self.registry = GameRegistry()
        hub, rooms = LobbyHub(), GameRooms()
        timing = Timing(
            vote_seconds=vote_seconds,
            timer_modes=timer_modes or TIMER_MODES,
            grace_seconds=0,
        )
        self.sockets = {
            "Esteban": RecordingSocket(),
            "Ana": ana_socket or RecordingSocket(),
            "Luis": RecordingSocket(),
        }
        self.sessions = {
            name: ClientSession(
                socket, self.registry, hub, rooms, TURN_ORDER, timing
            )
            for name, socket in self.sockets.items()
        }

    async def start(self) -> None:
        await self.sessions["Esteban"].handle(
            create_message(maxPlayers=3, timer=self.timer)
        )
        await self.sessions["Ana"].handle(join_message())
        await self.sessions["Luis"].handle(join_message(**LUIS_JOINS))

    async def send(self, name: str, message: dict[str, Any]) -> None:
        await self.sessions[name].handle(message)

    def vote_timer(self) -> asyncio.Task[None] | None:
        return self.sessions["Luis"].table.vote_timer

    def sent_counts(self) -> list[int]:
        return [len(socket.sent) for socket in self.sockets.values()]


async def settle_tasks() -> None:
    for _ in range(10):
        await asyncio.sleep(0)


@pytest.mark.parametrize(
    "actions",
    [
        pytest.param([("Esteban", vote_end(True))], id="vote-passes"),
        pytest.param(
            [("Esteban", vote_end(False)), ("Luis", vote_end(False))],
            id="vote-fails",
        ),
        pytest.param([("Ana", LEAVE)], id="proposer-leaves"),
        pytest.param(
            [("Esteban", vote_end(False)), ("Luis", LEAVE)],
            id="leaving-voter-settles",
        ),
        pytest.param([("Esteban", LEAVE), ("Ana", LEAVE)], id="game-ends"),
    ],
)
def test_closing_a_vote_early_cancels_its_timer(
    actions: list[tuple[str, dict[str, Any]]],
) -> None:
    async def scenario() -> None:
        game = Trio()
        await game.start()
        table = game.sessions["Luis"].table
        await game.send("Ana", PROPOSE)
        timer = table.vote_timer
        assert not timer.done()

        for name, message in actions:
            await game.send(name, message)
        sent = game.sent_counts()
        await settle_tasks()

        assert timer.cancelled()
        assert table.vote_timer is None
        assert game.sent_counts() == sent

    asyncio.run(scenario())


def test_a_vote_that_stays_open_keeps_its_timer() -> None:
    async def scenario() -> None:
        game = Trio()
        await game.start()
        await game.send("Ana", PROPOSE)
        timer = game.vote_timer()

        await game.send("Esteban", vote_end(False))
        await settle_tasks()

        assert game.vote_timer() is timer and not timer.done()

    asyncio.run(scenario())


def test_each_new_vote_gets_its_own_timer() -> None:
    async def scenario() -> None:
        game = Trio()
        await game.start()
        timers = []
        for _ in range(2):
            await game.send("Ana", PROPOSE)
            timers.append(game.vote_timer())
            await game.send("Esteban", vote_end(False))
            await game.send("Luis", vote_end(False))

        assert timers[0] is not timers[1]

    asyncio.run(scenario())


class StallingNoticeSocket(StallingSocket):
    """Holds back its first `vote_failed` until it is released."""

    held_type = "vote_failed"


def test_a_game_ending_during_an_expiry_does_not_cut_off_its_messages() -> None:
    async def scenario() -> None:
        slow = StallingNoticeSocket()
        game = Trio(ana_socket=slow, vote_seconds=0.01)
        await game.start()
        await game.send("Ana", PROPOSE)
        # The expiry is now stuck sending to "Ana", the second to be served.
        await asyncio.wait_for(slow.stalled.wait(), timeout=5)

        async def leave_until_the_game_ends() -> None:
            await game.send("Esteban", LEAVE)
            await game.send("Ana", LEAVE)

        leaving = asyncio.create_task(leave_until_the_game_ends())
        await settle_tasks()
        slow.release.set()
        await asyncio.wait_for(leaving, timeout=5)

        types = types_of(game.sockets["Luis"].sent)
        assert types[types.index("vote_failed") :][:2] == [
            "vote_failed",
            "game_state",
        ]
        assert types[-1] == "game_over"

    asyncio.run(scenario())


def use_timers(start: float, increment: float, grace: float = 0) -> None:
    """Make "fast" last what a test needs."""
    modes = {
        TimerMode.NONE: None,
        TimerMode.FAST: TimerSettings(start, increment),
    }
    app.dependency_overrides[get_timer_modes] = lambda: modes
    app.dependency_overrides[get_grace_seconds] = lambda: grace


def test_a_started_timed_game_sends_the_clocks_of_the_configured_mode(
    client: TestClient,
) -> None:
    use_timers(start=0.75, increment=0.2)
    with (
        client.websocket_connect("/api/ws") as host,
        client.websocket_connect("/api/ws") as ana,
    ):
        request(host, create_message(timer="fast"))
        ana.send_json(join_message())

        _, started = receive_types(ana, 2)

        state = started["state"]
        assert (started["type"], state["timer"]) == ("game_started", "fast")
        # A little may have run between the start and the message.
        assert 700 < state["clocks"]["Ana"] <= 750
        assert state["clocks"]["Esteban"] == 750
        assert state["chooseMsLeft"] is None


def test_the_grace_window_is_half_a_second_by_default() -> None:
    assert get_grace_seconds() == 0.5


def test_the_timer_modes_are_the_official_ones_by_default() -> None:
    assert get_timer_modes() is TIMER_MODES


def start_timed(
    host: WebSocketTestSession, *others: WebSocketTestSession
) -> None:
    """Start a "fast" game of two or three players and read its messages.

    Nothing is read with a probe: a timeout could arrive before its reply.
    """
    host.send_json(create_message(timer="fast", maxPlayers=1 + len(others)))
    host.receive_json()
    joins = [join_message(), join_message(**LUIS_JOINS)]
    joined = [host]
    for socket, message in zip(others, joins):
        socket.send_json(message)
        assert socket.receive_json()["type"] == "game_joined"
        for earlier in joined:
            assert earlier.receive_json()["type"] == "game_updated"
        joined.append(socket)
    for socket in joined:
        assert socket.receive_json()["type"] == "game_started"


def test_a_turn_that_runs_out_of_time_is_announced_to_every_player(
    client: TestClient,
) -> None:
    use_timers(start=0.4, increment=0.2)
    with (
        client.websocket_connect("/api/ws") as host,
        client.websocket_connect("/api/ws") as ana,
        client.websocket_connect("/api/ws") as luis,
    ):
        start_timed(host, ana, luis)

        for socket in (ana, host, luis):
            timed_out, updated = receive_types(socket, 2)

            assert timed_out == {"type": "turn_timed_out", "player": "Ana"}
            assert updated["type"] == "game_state"
            state = updated["state"]
            assert state["currentPlayer"] == "Esteban"
            assert state["clocks"]["Ana"] == 400
            assert state["lastMove"] is None

        ana.send_json(mark(0, 0))

        assert ana.receive_json() == {"type": "error", "code": "not_your_turn"}


def test_every_new_turn_gets_its_own_timeout(client: TestClient) -> None:
    use_timers(start=0.2, increment=0.2)
    with (
        client.websocket_connect("/api/ws") as host,
        client.websocket_connect("/api/ws") as ana,
    ):
        start_timed(host, ana)

        timed_out = [receive_types(ana, 2)[0]["player"] for _ in range(3)]

        assert timed_out == ["Ana", "Esteban", "Ana"]


def test_a_move_within_the_grace_window_counts_as_in_time(
    client: TestClient,
) -> None:
    use_timers(start=0.1, increment=0.2, grace=1)
    with (
        client.websocket_connect("/api/ws") as host,
        client.websocket_connect("/api/ws") as ana,
    ):
        start_timed(host, ana)
        # Past the end of "Ana"'s clock, and well within the grace window.
        time.sleep(0.3)

        ana.send_json(mark(0, 0))

        for socket in (ana, host):
            moved = socket.receive_json()
            assert moved["type"] == "game_state"
            assert moved["state"]["clocks"]["Ana"] == 200
        # The first timeout of the game is the one of the next turn.
        assert ana.receive_json() == {"type": "turn_timed_out", "player": "Esteban"}


def test_an_expired_choose_clock_picks_the_first_candidate(
    client: TestClient, registry: GameRegistry
) -> None:
    # Half the increment rounds up to a choose clock of one second.
    use_timers(start=30, increment=0.2)
    with (
        client.websocket_connect("/api/ws") as host,
        client.websocket_connect("/api/ws") as ana,
    ):
        start_timed(host, ana)
        match = registry.list()[0].match
        for row, col in [(0, 0), (0, 2), (0, 4), (1, 0), (1, 1), (1, 3), (1, 4)]:
            match.board[row][col] = Cell("Ana")
        ana.send_json(mark(1, 2))
        choosing = ana.receive_json()["state"]
        host.receive_json()
        assert (choosing["phase"], choosing["chooseMsLeft"] > 900) == ("choose", True)

        for socket in (ana, host):
            picked = socket.receive_json()

            # No `turn_timed_out` comes first.
            assert picked["type"] == "game_state"
            state = picked["state"]
            assert state["scores"] == {"Ana": 1, "Esteban": 0}
            assert state["currentPlayer"] == "Esteban"
            assert state["chooseMsLeft"] is None
            for cell in choosing["candidates"][0] if socket is ana else []:
                assert state["board"][cell["row"]][cell["col"]]["disabled"]


def test_no_turn_times_out_during_a_vote_and_the_countdown_resumes(
    client: TestClient,
) -> None:
    use_timers(start=0.4, increment=0.2)
    with (
        client.websocket_connect("/api/ws") as host,
        client.websocket_connect("/api/ws") as ana,
    ):
        start_timed(host, ana)
        ana.send_json(PROPOSE)
        frozen = ana.receive_json()["state"]["clocks"]["Ana"]
        host.receive_json()

        time.sleep(0.6)
        # No timer runs, so a probe cannot race with a timeout.
        assert pending_messages(host) == []
        host.send_json(vote_end(False))

        _, resumed, timed_out, _ = receive_types(ana, 4)
        assert resumed["state"]["clocks"]["Ana"] <= frozen
        assert timed_out == {"type": "turn_timed_out", "player": "Ana"}


def test_the_next_player_is_timed_when_the_current_one_leaves(
    client: TestClient,
) -> None:
    use_timers(start=0.4, increment=0.2)
    with (
        client.websocket_connect("/api/ws") as host,
        client.websocket_connect("/api/ws") as ana,
        client.websocket_connect("/api/ws") as luis,
    ):
        start_timed(host, ana, luis)

        ana.send_json(LEAVE)

        for socket in (host, luis):
            left, timed_out, _ = receive_types(socket, 3)
            assert left["state"]["currentPlayer"] == "Esteban"
            assert timed_out == {"type": "turn_timed_out", "player": "Esteban"}


def timed_trio() -> Trio:
    """A timed three-player game whose clocks never run out during a test."""
    game = Trio()
    game.timer = "fast"
    return game


def fill_all_but_one_cell(game: Trio) -> None:
    leave_one_cell_empty(game.registry, {})


@pytest.mark.parametrize(
    ("prepare", "actions"),
    [
        pytest.param(fill_all_but_one_cell, [("Ana", mark(9, 11))], id="board-full"),
        pytest.param(
            None,
            [("Ana", PROPOSE), ("Esteban", vote_end(True))],
            id="vote-passes",
        ),
        pytest.param(None, [("Esteban", LEAVE), ("Ana", LEAVE)], id="last-player"),
    ],
)
def test_a_game_that_ends_leaves_no_turn_timer(
    prepare: Callable[[Trio], None] | None,
    actions: list[tuple[str, dict[str, Any]]],
) -> None:
    async def scenario() -> None:
        game = timed_trio()
        await game.start()
        table = game.sessions["Luis"].table
        assert table.turn_timer is not None
        if prepare:
            prepare(game)
        timers = [table.turn_timer]

        for name, message in actions:
            await game.send(name, message)
            if table.turn_timer is not None:
                timers.append(table.turn_timer)
        sent = game.sent_counts()
        await settle_tasks()

        assert table.turn_timer is None
        assert all(timer.cancelled() for timer in timers)
        assert game.sent_counts() == sent

    asyncio.run(scenario())


def test_an_untimed_game_never_has_a_turn_timer() -> None:
    async def scenario() -> None:
        game = Trio()
        await game.start()
        table = game.sessions["Luis"].table
        assert table.turn_timer is None

        for name, message in [
            ("Ana", mark(0, 0)),
            ("Esteban", PROPOSE),
            ("Ana", vote_end(False)),
            ("Luis", vote_end(False)),
            ("Esteban", LEAVE),
        ]:
            await game.send(name, message)

            assert table.turn_timer is None

    asyncio.run(scenario())


class StallingTimeoutSocket(StallingSocket):
    """Holds back its first `turn_timed_out` until it is released."""

    held_type = "turn_timed_out"


def test_a_change_during_a_timeout_does_not_cut_off_its_messages() -> None:
    async def scenario() -> None:
        slow = StallingTimeoutSocket()
        modes = {TimerMode.FAST: TimerSettings(0.01, 0.2)}
        game = Trio(ana_socket=slow, timer_modes=modes)
        game.timer = "fast"
        await game.start()
        # The timeout is now stuck sending to "Ana", the second to be served.
        await asyncio.wait_for(slow.stalled.wait(), timeout=5)

        async def leave_until_the_game_ends() -> None:
            await game.send("Esteban", LEAVE)
            await game.send("Ana", LEAVE)

        leaving = asyncio.create_task(leave_until_the_game_ends())
        await settle_tasks()
        slow.release.set()
        await asyncio.wait_for(leaving, timeout=5)

        types = types_of(game.sockets["Luis"].sent)
        assert types[types.index("turn_timed_out") :][:2] == [
            "turn_timed_out",
            "game_state",
        ]
        assert types[-1] == "game_over"

    asyncio.run(scenario())
