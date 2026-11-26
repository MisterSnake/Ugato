from __future__ import annotations

from typing import TYPE_CHECKING

from app.games.models import Game, Player

if TYPE_CHECKING:
    from app.games.ws import ClientSession


class Room:
    """The connections in one game: its host and its joined players."""

    def __init__(self, game: Game, host: ClientSession) -> None:
        self.game = game
        self.host = host
        # In join order, like the players of the game.
        self.joined: dict[ClientSession, Player] = {}


class GameRooms:
    """The room of each live game.

    It keeps the player list of a game and the connections in its room in step.
    """

    def __init__(self) -> None:
        self._rooms: dict[str, Room] = {}

    def open(self, game: Game, host: ClientSession) -> None:
        self._rooms[self._key(game)] = Room(game, host)

    def add(self, game: Game, session: ClientSession, player: Player) -> None:
        self._rooms[self._key(game)].joined[session] = player
        game.players.append(player)

    def remove(self, game: Game, session: ClientSession) -> None:
        player = self._rooms[self._key(game)].joined.pop(session)
        game.players.remove(player)

    def members(self, game: Game) -> list[ClientSession]:
        room = self._find(game)
        return [] if room is None else [room.host, *room.joined]

    def close(self, game: Game) -> list[ClientSession]:
        """Forget the room of a game. Return the players who were in it."""
        room = self._find(game)
        if room is None:
            return []
        del self._rooms[self._key(game)]
        return list(room.joined)

    def _find(self, game: Game) -> Room | None:
        room = self._rooms.get(self._key(game))
        # An older game that reused the name must not reach the new room.
        return room if room is not None and room.game is game else None

    @staticmethod
    def _key(game: Game) -> str:
        return game.name.casefold()


_rooms = GameRooms()


def get_game_rooms() -> GameRooms:
    return _rooms
