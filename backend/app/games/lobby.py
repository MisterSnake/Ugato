from typing import Any

from fastapi import WebSocket

from app.games.fanout import send_to_each
from app.games.models import Game, GameStatus
from app.games.registry import GameRegistry


def game_summary(game: Game) -> dict[str, Any]:
    return {
        "name": game.name,
        "maxPlayers": game.max_players,
        "boardWidth": game.board_width,
        "boardHeight": game.board_height,
        "status": game.status,
        "players": [
            {"name": player.name, "color": player.color}
            for player in game.players
            if game.match is None or player.name not in game.match.left
        ],
    }


def lobby_snapshot(registry: GameRegistry) -> dict[str, Any]:
    """The `games_list` message: waiting games first, then the ones in progress.

    Each group goes from newest to oldest.
    """
    # The sort is stable, so each group keeps the newest-first order.
    games = sorted(reversed(registry.list()), key=_is_playing)
    return {
        "type": "games_list",
        "games": [game_summary(game) for game in games],
    }


def _is_playing(game: Game) -> bool:
    return game.status is GameStatus.PLAYING


class LobbyHub:
    """The connections that receive lobby updates."""

    def __init__(self) -> None:
        self._subscribers: set[WebSocket] = set()

    def subscribe(self, websocket: WebSocket) -> None:
        self._subscribers.add(websocket)

    def unsubscribe(self, websocket: WebSocket) -> None:
        self._subscribers.discard(websocket)

    async def broadcast(self, message: dict[str, Any]) -> None:
        for websocket in await send_to_each(self._subscribers, message):
            self.unsubscribe(websocket)


_hub = LobbyHub()


def get_lobby_hub() -> LobbyHub:
    return _hub
