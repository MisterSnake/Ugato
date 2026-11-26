import json
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Annotated, Any

from fastapi import APIRouter, Depends, WebSocket

from app.games.fanout import send_to_each
from app.games.lobby import LobbyHub, game_summary, get_lobby_hub, lobby_snapshot
from app.games.models import Game, Player
from app.games.registry import GameRegistry, get_registry
from app.games.rooms import GameRooms, get_game_rooms
from app.games.validation import (
    ValidationError,
    check_can_join,
    validate_create_request,
    validate_join_request,
)

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


@dataclass(frozen=True)
class HostRole:
    game: Game


@dataclass(frozen=True)
class PlayerRole:
    game: Game
    player: Player


class ClientSession:
    """The state of one connection.

    It can follow the lobby and be in at most one game, as its host or as a
    joined player.
    """

    def __init__(
        self,
        websocket: WebSocket,
        registry: GameRegistry,
        hub: LobbyHub,
        rooms: GameRooms,
    ) -> None:
        self._websocket = websocket
        self._registry = registry
        self._hub = hub
        self._rooms = rooms
        self._role: HostRole | PlayerRole | None = None

    @property
    def websocket(self) -> WebSocket:
        return self._websocket

    async def handle(self, message: dict[str, Any] | None) -> None:
        match message:
            case {"type": "subscribe_lobby"}:
                self._hub.subscribe(self._websocket)
                await self._websocket.send_json(lobby_snapshot(self._registry))
            case {"type": "create_game"}:
                await self._create(message)
            case {"type": "join_game"}:
                await self._join(message)
            case {"type": "cancel_game"}:
                await self._cancel()
            case {"type": "leave_game"}:
                await self._leave()
            case _:
                await send_error(self._websocket, "invalid_message")

    async def close(self) -> None:
        # Unsubscribed first, so the broadcast never targets the closing socket.
        self._hub.unsubscribe(self._websocket)
        if left := self._leave_room():
            await self._send_roster(left)
            await self._broadcast_lobby()
        elif (players := self._end_game()) is not None:
            await self._announce_end(players)

    def _leave_room(self) -> Game | None:
        """Take this connection out of the game it joined. Return that game."""
        if not isinstance(self._role, PlayerRole):
            return None
        game = self._role.game
        self._rooms.remove(game, self)
        self._role = None
        return game

    async def _leave(self) -> None:
        left = self._leave_room()
        try:
            await self._websocket.send_json({"type": "game_left"})
        finally:
            # The others must hear about it even if the leaver is already gone.
            if left:
                await self._send_roster(left)
                await self._broadcast_lobby()

    def _end_game(self) -> list["ClientSession"] | None:
        """Remove the game this connection hosts.

        Return the players who were in it, or None if there was no game.
        """
        if not isinstance(self._role, HostRole):
            return None
        players = self._rooms.close(self._role.game)
        self._registry.remove(self._role.game)
        self._role = None
        # Cleared before any send, so nobody is left holding a removed game.
        for player in players:
            player.forget_game()
        return players

    def forget_game(self) -> None:
        self._role = None

    async def _announce_end(self, players: list["ClientSession"]) -> None:
        await send_to_each(
            [player.websocket for player in players], {"type": "game_closed"}
        )
        await self._broadcast_lobby()

    async def _cancel(self) -> None:
        players = self._end_game()
        try:
            await self._websocket.send_json({"type": "game_cancelled"})
        finally:
            # The others must hear about it even if the creator is already gone.
            if players is not None:
                await self._announce_end(players)

    async def _create(self, message: dict[str, Any]) -> None:
        if self._role is not None:
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
        self._rooms.open(game, self)
        self._role = HostRole(game)
        await self._websocket.send_json(
            {"type": "game_created", "game": game_summary(game)}
        )
        await self._broadcast_lobby()

    async def _join(self, message: dict[str, Any]) -> None:
        if self._role is not None:
            await send_error(self._websocket, "already_in_game")
            return
        # No await from here to the add, so the checks and the add are atomic.
        try:
            game_name, player = validate_join_request(message)
            game = self._registry.find_by_name(game_name)
            if game is None:
                raise ValidationError("gameName", "game_not_found")
            check_can_join(game, player)
        except ValidationError as error:
            await send_error(self._websocket, error.code, error.field)
            return
        self._rooms.add(game, self, player)
        self._role = PlayerRole(game, player)
        await self._websocket.send_json(
            {"type": "game_joined", "game": game_summary(game)}
        )
        await self._send_roster(game)
        await self._broadcast_lobby()

    async def _send_roster(self, game: Game) -> None:
        """Send the player list to everyone in the game but this connection."""
        others = [
            member.websocket
            for member in self._rooms.members(game)
            if member is not self
        ]
        await send_to_each(others, {"type": "game_updated", "game": game_summary(game)})

    async def _broadcast_lobby(self) -> None:
        await self._hub.broadcast(lobby_snapshot(self._registry))


@router.websocket("/api/ws")
async def game_socket(
    websocket: WebSocket,
    registry: Annotated[GameRegistry, Depends(get_registry)],
    hub: Annotated[LobbyHub, Depends(get_lobby_hub)],
    rooms: Annotated[GameRooms, Depends(get_game_rooms)],
) -> None:
    await websocket.accept()
    session = ClientSession(websocket, registry, hub, rooms)
    try:
        async for text in iter_frames(websocket):
            await session.handle(parse_message(text))
    finally:
        # A game lives only as long as its creator's connection, and a player
        # stays in it only as long as theirs.
        await session.close()
