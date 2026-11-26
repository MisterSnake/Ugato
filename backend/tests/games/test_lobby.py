import asyncio
from typing import Any

from app.games.lobby import LobbyHub, get_lobby_hub, lobby_snapshot
from app.games.models import Color, Game, Player
from app.games.registry import GameRegistry


def make_game(name: str) -> Game:
    return Game(
        name=name,
        max_players=2,
        board_width=12,
        board_height=10,
        players=[Player(name="Esteban", color=Color.RED)],
    )


def summary(name: str) -> dict[str, object]:
    return {
        "name": name,
        "maxPlayers": 2,
        "boardWidth": 12,
        "boardHeight": 10,
        "players": [{"name": "Esteban", "color": "red"}],
    }


def test_snapshot_of_an_empty_registry() -> None:
    assert lobby_snapshot(GameRegistry()) == {"type": "games_list", "games": []}


def test_snapshot_lists_the_newest_game_first() -> None:
    registry = GameRegistry()
    registry.add(make_game("Partida 1"))
    registry.add(make_game("Duel"))

    assert lobby_snapshot(registry) == {
        "type": "games_list",
        "games": [summary("Duel"), summary("Partida 1")],
    }


class FakeSocket:
    def __init__(self) -> None:
        self.sent: list[Any] = []

    async def send_json(self, message: Any) -> None:
        self.sent.append(message)


MESSAGE = {"type": "games_list", "games": []}


def test_broadcast_reaches_every_subscriber_once() -> None:
    hub = LobbyHub()
    first, second = FakeSocket(), FakeSocket()
    hub.subscribe(first)
    hub.subscribe(second)

    asyncio.run(hub.broadcast(MESSAGE))

    assert first.sent == [MESSAGE]
    assert second.sent == [MESSAGE]


def test_subscribing_twice_still_delivers_once() -> None:
    hub = LobbyHub()
    socket = FakeSocket()
    hub.subscribe(socket)
    hub.subscribe(socket)

    asyncio.run(hub.broadcast(MESSAGE))

    assert socket.sent == [MESSAGE]


def test_unsubscribed_socket_receives_nothing() -> None:
    hub = LobbyHub()
    socket = FakeSocket()
    hub.subscribe(socket)
    hub.unsubscribe(socket)

    asyncio.run(hub.broadcast(MESSAGE))

    assert socket.sent == []


def test_get_lobby_hub_returns_one_shared_hub() -> None:
    assert get_lobby_hub() is get_lobby_hub()


class BrokenSocket:
    def __init__(self) -> None:
        self.attempts = 0

    async def send_json(self, message: Any) -> None:
        self.attempts += 1
        raise RuntimeError("connection is gone")


def test_failed_subscriber_does_not_block_the_others_and_is_dropped() -> None:
    hub = LobbyHub()
    first, broken, last = FakeSocket(), BrokenSocket(), FakeSocket()
    for socket in (first, broken, last):
        hub.subscribe(socket)

    asyncio.run(hub.broadcast(MESSAGE))
    asyncio.run(hub.broadcast(MESSAGE))

    assert first.sent == [MESSAGE, MESSAGE]
    assert last.sent == [MESSAGE, MESSAGE]
    assert broken.attempts == 1


def listed_order(registry: GameRegistry) -> list[str]:
    return [game["name"] for game in lobby_snapshot(registry)["games"]]


def fill(game: Game) -> None:
    game.players.append(Player(name="Ana", color=Color.BLUE))


def test_snapshot_lists_full_games_last_each_group_newest_first() -> None:
    registry = GameRegistry()
    older, newer = make_game("Partida 1"), make_game("Duel")
    registry.add(older)
    registry.add(newer)

    fill(newer)
    assert listed_order(registry) == ["Partida 1", "Duel"]

    fill(older)
    assert listed_order(registry) == ["Duel", "Partida 1"]

    older.players.pop()
    newer.players.pop()
    assert listed_order(registry) == ["Duel", "Partida 1"]
