import json
from collections.abc import AsyncIterator
from typing import Annotated, Any

from fastapi import APIRouter, Depends, WebSocket

from app.games.lobby import LobbyHub, game_summary, get_lobby_hub, lobby_snapshot
from app.games.models import Game
from app.games.registry import GameRegistry, get_registry
from app.games.validation import ValidationError, validate_create_request

router = APIRouter()


def parse_message(text: str | None) -> dict[str, Any] | None:
    """Return the decoded JSON object, or None if the frame does not hold one."""
    if text is None:
        return None
    try:
        message = json.loads(text)
    except (ValueError, RecursionError):
        return None
    return message if isinstance(message, dict) else None


async def iter_frames(websocket: WebSocket) -> AsyncIterator[str | None]:
    """Yield each frame's text (None for binary frames) until the client leaves."""
    while True:
        frame = await websocket.receive()
        if frame["type"] == "websocket.disconnect":
            return
        yield frame.get("text")


async def send_error(
    websocket: WebSocket, code: str, field: str | None = None
) -> None:
    message = {"type": "error", "code": code}
    if field is not None:
        message["field"] = field
    await websocket.send_json(message)


class ClientSession:
    """The state of one connection.

    It can follow the lobby and own at most one game, as its creator.
    """

    def __init__(
        self, websocket: WebSocket, registry: GameRegistry, hub: LobbyHub
    ) -> None:
        self._websocket = websocket
        self._registry = registry
        self._hub = hub
        self._game: Game | None = None

    async def handle(self, message: dict[str, Any] | None) -> None:
        match message:
            case {"type": "subscribe_lobby"}:
                self._hub.subscribe(self._websocket)
                await self._websocket.send_json(lobby_snapshot(self._registry))
            case {"type": "create_game"}:
                await self._create(message)
            case {"type": "cancel_game"}:
                await self._cancel()
            case _:
                await send_error(self._websocket, "invalid_message")

    async def close(self) -> None:
        # Unsubscribed first, so the broadcast never targets the closing socket.
        self._hub.unsubscribe(self._websocket)
        if self._end_game():
            await self._broadcast_lobby()

    def _end_game(self) -> bool:
        """Remove this connection's game. Return whether there was one."""
        if self._game is None:
            return False
        self._registry.remove(self._game)
        self._game = None
        return True

    async def _cancel(self) -> None:
        removed = self._end_game()
        try:
            await self._websocket.send_json({"type": "game_cancelled"})
        finally:
            # The others must hear about it even if the creator is already gone.
            if removed:
                await self._broadcast_lobby()

    async def _create(self, message: dict[str, Any]) -> None:
        if self._game is not None:
            await send_error(self._websocket, "already_in_game")
            return
        try:
            game = validate_create_request(message)
        except ValidationError as error:
            await send_error(self._websocket, error.code, error.field)
            return
        # No await between this check and the add, so the pair is atomic.
        if self._registry.exists_by_name(game.name):
            await send_error(self._websocket, "name_taken", "gameName")
            return
        self._registry.add(game)
        self._game = game
        await self._websocket.send_json(
            {"type": "game_created", "game": game_summary(game)}
        )
        await self._broadcast_lobby()

    async def _broadcast_lobby(self) -> None:
        await self._hub.broadcast(lobby_snapshot(self._registry))


@router.websocket("/api/ws")
async def game_socket(
    websocket: WebSocket,
    registry: Annotated[GameRegistry, Depends(get_registry)],
    hub: Annotated[LobbyHub, Depends(get_lobby_hub)],
) -> None:
    await websocket.accept()
    session = ClientSession(websocket, registry, hub)
    try:
        async for text in iter_frames(websocket):
            await session.handle(parse_message(text))
    finally:
        # A game lives only as long as its creator's connection.
        await session.close()
