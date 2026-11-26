import asyncio
from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient
from starlette.testclient import WebSocketTestSession

from app.games.lobby import LobbyHub, get_lobby_hub
from app.games.models import Color, Game, Player
from app.games.registry import GameRegistry, get_registry
from app.games.rooms import GameRooms, get_game_rooms
from app.games.ws import ClientSession
from app.main import app


PROBE_REPLY = {"type": "error", "code": "invalid_message"}


@pytest.fixture
def registry() -> Iterator[GameRegistry]:
    fresh_registry = GameRegistry()
    app.dependency_overrides[get_registry] = lambda: fresh_registry
    fresh_hub = LobbyHub()
    app.dependency_overrides[get_lobby_hub] = lambda: fresh_hub
    fresh_rooms = GameRooms()
    app.dependency_overrides[get_game_rooms] = lambda: fresh_rooms
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


def partida(*players: tuple[str, str]) -> dict[str, Any]:
    """The summary of the game made by `create_message(maxPlayers=3)`."""
    return {
        "name": "Partida 1",
        "maxPlayers": 3,
        "boardWidth": 12,
        "boardHeight": 10,
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
        request(host, create_message(maxPlayers=3))
        subscribe(watcher)

        replies = request(ana, join_message(gameName=" partida 1 "))

        assert replies == [{"type": "game_joined", "game": partida(HOST, ANA)}]
        assert pending_messages(host) == [
            {"type": "game_updated", "game": partida(HOST, ANA)}
        ]
        assert pending_messages(watcher) == [listing(partida(HOST, ANA))]

        request(luis, join_message(username="Luis", color="green"))

        updated = {"type": "game_updated", "game": partida(HOST, ANA, LUIS)}
        assert pending_messages(host) == [updated]
        assert pending_messages(ana) == [updated]


def test_subscribed_joiner_is_confirmed_before_receiving_the_new_list(
    client: TestClient,
) -> None:
    with (
        client.websocket_connect("/api/ws") as host,
        client.websocket_connect("/api/ws") as ana,
    ):
        request(host, create_message())
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
        ({"gameName": "Full house"}, "gameName", "game_full"),
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
    assert [r["code"] for r in first_replies if r["type"] == "error"] == ["game_full"]
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
        await host.handle(create_message(maxPlayers=3))
        await ana.handle(join_message())
        await luis.handle(join_message(username="Luis", color="green"))
        hub.subscribe(watcher)
        await host.handle({"type": "cancel_game"})

    asyncio.run(join_then_cancel())

    assert luis_socket.sent[-1] == GAME_CLOSED
    assert watcher.sent == [listing()]
