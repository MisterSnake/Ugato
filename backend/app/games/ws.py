import asyncio
import json
from collections.abc import AsyncIterator, Callable, Mapping
from dataclasses import dataclass, field
from random import Random
from typing import Annotated, Any

from fastapi import APIRouter, Depends, WebSocket, status

from app.games.fanout import send_to_each
from app.games.lobby import LobbyHub, game_summary, get_lobby_hub, lobby_snapshot
from app.games.match import (
    VOTE_SECONDS,
    EndReason,
    FailedVote,
    Match,
    TimedOut,
    game_over_payload,
    get_random,
    get_timer_modes,
    get_vote_seconds,
    match_state,
)
from app.games.models import Game, Player, TimerMode
from app.games.registry import GameRegistry, get_registry
from app.games.rooms import GameRooms, get_game_rooms
from app.games.validation import (
    TIMER_MODES,
    TimerSettings,
    ValidationError,
    check_can_join,
    validate_create_request,
    validate_join_request,
)
from app.settings import Settings, get_settings

router = APIRouter()

# A clock that reached 0 is only acted on this much later, so that a move sent
# just in time still counts.
GRACE_SECONDS = 0.5


@dataclass(frozen=True)
class Timing:
    """How long the timed parts of a game take."""

    vote_seconds: float = VOTE_SECONDS
    timer_modes: Mapping[TimerMode, TimerSettings | None] = field(
        default_factory=lambda: TIMER_MODES
    )
    grace_seconds: float = GRACE_SECONDS


def get_grace_seconds() -> float:
    return GRACE_SECONDS


def get_timing(
    vote_seconds: Annotated[float, Depends(get_vote_seconds)],
    timer_modes: Annotated[
        Mapping[TimerMode, TimerSettings | None], Depends(get_timer_modes)
    ],
    grace_seconds: Annotated[float, Depends(get_grace_seconds)],
) -> Timing:
    return Timing(vote_seconds, timer_modes, grace_seconds)


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


@dataclass
class Table:
    """What the connections of one started game share."""

    # Keeps the updates of the game in order.
    outbox: asyncio.Lock = field(default_factory=asyncio.Lock)
    # Expires the open vote. It belongs to the game, not to a connection.
    vote_timer: asyncio.Task[None] | None = None
    # Acts when the running clock runs out. It belongs to the game too.
    turn_timer: asyncio.Task[None] | None = None
    # The `clock_epoch` the turn timer was started for.
    turn_timer_epoch: int = 0

    def stop_vote_timer(self) -> None:
        if self.vote_timer is not None:
            self.vote_timer.cancel()
            self.vote_timer = None

    def stop_turn_timer(self) -> None:
        if self.turn_timer is not None:
            self.turn_timer.cancel()
            self.turn_timer = None


# The timers that ran out and are still sending. No table holds them any more,
# and the event loop does not keep its tasks alive by itself.
_expiring: set[asyncio.Task[None]] = set()


def _keep_expiring_task() -> None:
    """Hold on to the running timer task once its table lets go of it."""
    task = asyncio.current_task()
    _expiring.add(task)
    task.add_done_callback(_expiring.discard)


@dataclass(frozen=True)
class PlayingRole:
    """A seat in a started game. The host plays like everyone else."""

    game: Game
    player: Player
    table: Table


def _vote_notice(failed: FailedVote | None) -> dict[str, Any] | None:
    if failed is None:
        return None
    return {
        "type": "vote_failed",
        "proposer": failed.proposer,
        "endVotes": failed.end_votes,
        "continueVotes": failed.continue_votes,
    }


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
        timing: Timing | None = None,
    ) -> None:
        self._websocket = websocket
        self._registry = registry
        self._hub = hub
        self._rooms = rooms
        self._random = rng or get_random()
        self._timing = timing or Timing()
        self._role: HostRole | PlayerRole | PlayingRole | None = None

    @property
    def websocket(self) -> WebSocket:
        return self._websocket

    @property
    def table(self) -> Table | None:
        """The table of the started game this connection plays in."""
        return self._role.table if isinstance(self._role, PlayingRole) else None

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
            case {"type": "propose_end"}:
                await self._play(lambda match, name: match.propose_end(name))
            case {"type": "vote_end"}:
                end = message.get("end")
                await self._play(lambda match, name: match.vote_end(name, end))
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
        failed = match.leave(role.player.name)
        if match.result is None:
            deliveries = self._update_deliveries(role.game, _vote_notice(failed))
        else:
            deliveries = self._finish(role.game)
        self._sync_timers(role.game, role.table)
        if confirmation is not None:
            deliveries.insert(0, (self._websocket, confirmation))
        await deliver(role.table.outbox, deliveries)
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
        game.match = Match(
            names,
            game.board_width,
            game.board_height,
            self._random,
            vote_seconds=self._timing.vote_seconds,
            timer=game.timer,
            timer_modes=self._timing.timer_modes,
        )
        table = Table()
        for session, player in self._rooms.seats(game):
            session.start_playing(PlayingRole(game, player, table))
        summary = game_summary(game)
        joined = (self._websocket, {"type": "game_joined", "game": summary})
        updated = {"type": "game_updated", "game": summary}
        self._sync_timers(game, table)
        await deliver(
            table.outbox,
            [
                joined,
                *((websocket, updated) for websocket in self._others(game)),
                *self._state_deliveries(game, "game_started"),
            ],
        )

    def start_playing(self, role: PlayingRole) -> None:
        self._role = role

    async def _play(self, move: Callable[[Match, str], FailedVote | None]) -> None:
        role = self._role
        if not isinstance(role, PlayingRole):
            await send_error(self._websocket, "game_not_started")
            return
        try:
            failed = move(role.game.match, role.player.name)
        except ValidationError as error:
            await send_error(self._websocket, error.code, error.field)
            return
        # No await from the move to the delivery, so nothing can slip in between.
        await self._publish(role.game, role.table, _vote_notice(failed))

    async def _publish(
        self, game: Game, table: Table, notice: dict[str, Any] | None
    ) -> None:
        """Tell everyone about a change to the match, ending the game if over.

        It must be awaited with no await since the change.
        """
        result = game.match.result
        over = result is not None
        deliveries: list[Delivery] = []
        # The last mark is shown before the end it caused. A passed vote has no
        # move to show.
        if result is None or result.reason is EndReason.BOARD_FULL:
            deliveries = self._update_deliveries(game, notice)
        if over:
            deliveries += self._finish(game)
        self._sync_timers(game, table)
        await deliver(table.outbox, deliveries)
        if over:
            await self._broadcast_lobby()

    def _sync_timers(self, game: Game, table: Table) -> None:
        """Make the timers match the game. It must follow every change."""
        self._sync_vote_timer(game, table)
        self._sync_turn_timer(game, table)

    def _sync_vote_timer(self, game: Game, table: Table) -> None:
        """Keep a timer running exactly while a vote is open."""
        vote = game.match.vote
        if vote is None:
            table.stop_vote_timer()
        elif table.vote_timer is None:
            table.vote_timer = asyncio.create_task(
                self._expire_vote(game, table, vote.id)
            )

    async def _expire_vote(self, game: Game, table: Table, vote_id: int) -> None:
        """Close the vote when its time runs out.

        It only uses what the whole game shares, so it keeps working after this
        connection is gone.
        """
        await asyncio.sleep(game.match.vote_seconds)
        # From here on the task sends the result, so it leaves the table: a
        # change made meanwhile must not cancel it.
        _keep_expiring_task()
        table.vote_timer = None
        failed = game.match.expire_vote(vote_id)
        if failed is not None:
            await self._publish(game, table, _vote_notice(failed))

    def _sync_turn_timer(self, game: Game, table: Table) -> None:
        """Keep a timer for the running clock, if there is one."""
        deadline = game.match.clock_deadline()
        if deadline is None:
            table.stop_turn_timer()
            return
        epoch, seconds = deadline
        if table.turn_timer is None or table.turn_timer_epoch != epoch:
            table.stop_turn_timer()
            table.turn_timer_epoch = epoch
            delay = seconds + self._timing.grace_seconds
            table.turn_timer = asyncio.create_task(
                self._expire_turn(game, table, epoch, delay)
            )

    async def _expire_turn(
        self, game: Game, table: Table, epoch: int, delay: float
    ) -> None:
        """Act on the running clock once it and the grace window are over.

        Like `_expire_vote`, it keeps working after this connection is gone.
        """
        await asyncio.sleep(delay)
        _keep_expiring_task()
        table.turn_timer = None
        expired = game.match.expire_clock(epoch)
        if expired is None:
            return
        notice = None
        if isinstance(expired, TimedOut):
            notice = {"type": "turn_timed_out", "player": expired.player}
        await self._publish(game, table, notice)

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

    def _update_deliveries(
        self, game: Game, notice: dict[str, Any] | None
    ) -> list[Delivery]:
        """The new state, after the notice of what caused it, if there is one."""
        states = self._state_deliveries(game, "game_state")
        if notice is None:
            return states
        return [*((websocket, notice) for websocket, _ in states), *states]

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
    timing: Annotated[Timing, Depends(get_timing)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> None:
    # Browsers always send Origin; a client without one could forge it anyway.
    origin = websocket.headers.get("origin")
    if origin is not None and origin not in settings.allowed_origins:
        # Closing before accepting rejects the handshake itself.
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return
    await websocket.accept()
    session = ClientSession(websocket, registry, hub, rooms, rng, timing)
    try:
        async for text in iter_frames(websocket):
            await session.handle(parse_message(text))
    finally:
        # Before the start, a game lives only as long as its creator's connection.
        # After it, the host is an ordinary player. Every player stays in a game
        # only as long as their own connection.
        await session.close()
