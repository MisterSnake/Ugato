import asyncio
import json
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass
from random import Random
from typing import Annotated, Any

from fastapi import APIRouter, Depends, WebSocket

from app.games.fanout import send_to_each
from app.games.lobby import LobbyHub, game_summary, get_lobby_hub, lobby_snapshot
from app.games.match import Match, game_over_payload, get_random, match_state
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


@dataclass(frozen=True)
class PlayingRole:
    """A seat in a started game. The host plays like everyone else."""

    game: Game
    player: Player
    # Shared by every connection in the game, so its updates arrive in order.
    outbox: asyncio.Lock


# A message for one connection.
type Delivery = tuple[WebSocket, dict[str, Any]]


async def deliver(outbox: asyncio.Lock, deliveries: list[Delivery]) -> None:
    """Send the messages of one change, after those of the changes before it.

    The messages must be built, and this awaited, with no await since the
    change: the lock serves its waiters in order.
    """
    async with outbox:
        for websocket, message in deliveries:
            await send_to_each([websocket], message)


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
        rng: Random | None = None,
    ) -> None:
        self._websocket = websocket
        self._registry = registry
        self._hub = hub
        self._rooms = rooms
        self._random = rng or get_random()
        self._role: HostRole | PlayerRole | PlayingRole | None = None

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
            case {"type": "mark_cell"}:
                row, col = message.get("row"), message.get("col")
                await self._play(lambda match, name: match.mark(name, row, col))
            case {"type": "choose_u"}:
                index = message.get("index")
                await self._play(lambda match, name: match.choose(name, index))
            case {"type": "leave_game"}:
                await self._leave()
            case _:
                await send_error(self._websocket, "invalid_message")

    async def close(self) -> None:
        # Unsubscribed first, so the broadcast never targets the closing socket.
        self._hub.unsubscribe(self._websocket)
        if isinstance(self._role, PlayingRole):
            await self._quit_match(self._role)
        elif left := self._leave_room():
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

    async def _quit_match(
        self, role: PlayingRole, confirmation: dict[str, Any] | None = None
    ) -> None:
        """Leave a started game, which goes on without this connection."""
        self._role = None
        self._rooms.drop(role.game, self)
        match = role.game.match
        match.leave(role.player.name)
        if match.result is None:
            deliveries = self._state_deliveries(role.game, "game_state")
        else:
            deliveries = self._finish(role.game)
        if confirmation is not None:
            deliveries.insert(0, (self._websocket, confirmation))
        await deliver(role.outbox, deliveries)
        await self._broadcast_lobby()

    async def _leave(self) -> None:
        if isinstance(self._role, PlayingRole):
            await self._quit_match(self._role, confirmation={"type": "game_left"})
            return
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
        if len(game.players) == game.max_players:
            await self._start(game)
        else:
            await self._websocket.send_json(
                {"type": "game_joined", "game": game_summary(game)}
            )
            await self._send_roster(game)
        await self._broadcast_lobby()

    async def _start(self, game: Game) -> None:
        """Start the game this connection has just filled."""
        names = [player.name for player in game.players]
        game.match = Match(names, game.board_width, game.board_height, self._random)
        outbox = asyncio.Lock()
        for session, player in self._rooms.seats(game):
            session.start_playing(PlayingRole(game, player, outbox))
        summary = game_summary(game)
        joined = (self._websocket, {"type": "game_joined", "game": summary})
        updated = {"type": "game_updated", "game": summary}
        await deliver(
            outbox,
            [
                joined,
                *((websocket, updated) for websocket in self._others(game)),
                *self._state_deliveries(game, "game_started"),
            ],
        )

    def start_playing(self, role: PlayingRole) -> None:
        self._role = role

    async def _play(self, move: Callable[[Match, str], None]) -> None:
        role = self._role
        if not isinstance(role, PlayingRole):
            await send_error(self._websocket, "game_not_started")
            return
        try:
            move(role.game.match, role.player.name)
        except ValidationError as error:
            await send_error(self._websocket, error.code, error.field)
            return
        # No await from the move to the delivery, so nothing can slip in between.
        deliveries = self._state_deliveries(role.game, "game_state")
        over = role.game.match.result is not None
        if over:
            deliveries += self._finish(role.game)
        await deliver(role.outbox, deliveries)
        if over:
            await self._broadcast_lobby()

    def _finish(self, game: Game) -> list[Delivery]:
        """Remove a game whose match is over. Return the news for its players.

        It never awaits, so nobody can act on a finished match.
        """
        message = {"type": "game_over", **game_over_payload(game.match)}
        sessions = [session for session, _ in self._rooms.seats(game)]
        self._rooms.close(game)
        self._registry.remove(game)
        for session in sessions:
            session.forget_game()
        return [(session.websocket, message) for session in sessions]

    def _state_deliveries(self, game: Game, message_type: str) -> list[Delivery]:
        """The match as each player in the game sees it."""
        return [
            (
                session.websocket,
                {"type": message_type, "state": match_state(game.match, player.name)},
            )
            for session, player in self._rooms.seats(game)
        ]

    async def _send_roster(self, game: Game) -> None:
        """Send the player list to everyone in the game but this connection."""
        await send_to_each(
            self._others(game), {"type": "game_updated", "game": game_summary(game)}
        )

    def _others(self, game: Game) -> list[WebSocket]:
        return [
            member.websocket
            for member in self._rooms.members(game)
            if member is not self
        ]

    async def _broadcast_lobby(self) -> None:
        await self._hub.broadcast(lobby_snapshot(self._registry))


@router.websocket("/api/ws")
async def game_socket(
    websocket: WebSocket,
    registry: Annotated[GameRegistry, Depends(get_registry)],
    hub: Annotated[LobbyHub, Depends(get_lobby_hub)],
    rooms: Annotated[GameRooms, Depends(get_game_rooms)],
    rng: Annotated[Random, Depends(get_random)],
) -> None:
    await websocket.accept()
    session = ClientSession(websocket, registry, hub, rooms, rng)
    try:
        async for text in iter_frames(websocket):
            await session.handle(parse_message(text))
    finally:
        # A game lives only as long as its creator's connection, and a player
        # stays in it only as long as theirs.
        await session.close()
