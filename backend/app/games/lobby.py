from typing import Any

from fastapi import WebSocket

from app.games.models import Game
from app.games.registry import GameRegistry


def game_summary(game: Game) -> dict[str, Any]:
    return {
        "name": game.name,
        "maxPlayers": game.max_players,
        "boardWidth": game.board_width,
        "boardHeight": game.board_height,
        "players": [
            {"name": player.name, "color": player.color} for player in game.players
        ],
    }


def lobby_snapshot(registry: GameRegistry) -> dict[str, Any]:
    """The `games_list` message, newest game first."""
    return {
        "type": "games_list",
        "games": [game_summary(game) for game in reversed(registry.list())],
    }


class LobbyHub:
    """The connections that receive lobby updates."""

    def __init__(self) -> None:
        self._subscribers: set[WebSocket] = set()

    def subscribe(self, websocket: WebSocket) -> None:
        self._subscribers.add(websocket)

    def unsubscribe(self, websocket: WebSocket) -> None:
        self._subscribers.discard(websocket)

    async def broadcast(self, message: dict[str, Any]) -> None:
        # A copy, because connections can come and go while a send is awaited.
        for websocket in list(self._subscribers):
            try:
                await websocket.send_json(message)
            except Exception:
                # Whatever broke this connection must not affect the others.
                self.unsubscribe(websocket)


_hub = LobbyHub()


def get_lobby_hub() -> LobbyHub:
    return _hub
