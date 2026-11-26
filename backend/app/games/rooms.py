from __future__ import annotations

from typing import TYPE_CHECKING

from app.games.models import Game, Player

if TYPE_CHECKING:
    from app.games.ws import ClientSession


class Room:
    """The connections in one game: its host and its joined players.

    Once the game has started, a host who leaves is no longer in the room.
    """

    def __init__(self, game: Game, host: ClientSession) -> None:
        self.game = game
        self.host: ClientSession | None = host
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

    def drop(self, game: Game, session: ClientSession) -> None:
        """Take a connection out of a started game, which keeps its player."""
        room = self._rooms[self._key(game)]
        if session is room.host:
            room.host = None
        else:
            del room.joined[session]

    def members(self, game: Game) -> list[ClientSession]:
        return [session for session, _ in self.seats(game)]

    def seats(self, game: Game) -> list[tuple[ClientSession, Player]]:
        """Each connection in the game with the player it plays as."""
        room = self._find(game)
        if room is None:
            return []
        # The host is the first player of the game.
        host = [] if room.host is None else [(room.host, game.players[0])]
        return [*host, *room.joined.items()]

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
