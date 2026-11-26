"""The state of a started game and the rules that change it.

Nothing here knows about connections.
"""

import math
import time
from collections.abc import Callable, Mapping, Sequence
from dataclasses import asdict, dataclass
from enum import StrEnum
from random import Random
from typing import Any

from app.games.board import Board, Cell, Position, Shape, find_u_candidates
from app.games.models import TimerMode
from app.games.validation import (
    TIMER_MODES,
    TimerSettings,
    ValidationError,
    is_int_between,
)


VOTE_SECONDS = 30
MAX_END_PROPOSALS = 2


class Phase(StrEnum):
    MARK = "mark"
    CHOOSE = "choose"


class EndReason(StrEnum):
    BOARD_FULL = "board_full"
    LAST_PLAYER = "last_player"
    VOTE = "vote"


@dataclass(frozen=True)
class MatchResult:
    winners: list[str]
    reason: EndReason


@dataclass
class Vote:
    """An open vote to end the match."""

    id: int
    proposer: str
    deadline: float
    # True is a vote to end the match, which the proposer casts by proposing.
    votes: dict[str, bool]


@dataclass(frozen=True)
class FailedVote:
    proposer: str
    end_votes: int
    continue_votes: int


@dataclass(frozen=True)
class TimedOut:
    """A turn lost to the clock."""

    player: str


@dataclass(frozen=True)
class AutoChosen:
    """A U chosen for a player whose choose clock ran out."""

    player: str


class Match:
    def __init__(
        self,
        players: Sequence[str],
        width: int,
        height: int,
        rng: Random,
        clock: Callable[[], float] = time.monotonic,
        vote_seconds: float = VOTE_SECONDS,
        timer: TimerMode = TimerMode.NONE,
        timer_modes: Mapping[TimerMode, TimerSettings | None] = TIMER_MODES,
    ) -> None:
        self.clock = clock
        self.vote_seconds = vote_seconds
        self.board: Board = [[None] * width for _ in range(height)]
        self.turn_order = list(players)
        rng.shuffle(self.turn_order)
        self.phase = Phase.MARK
        self.candidates: list[Shape] = []
        self.scores = dict.fromkeys(self.turn_order, 0)
        self.left: set[str] = set()
        self.proposals_left = dict.fromkeys(self.turn_order, MAX_END_PROPOSALS)
        self.last_move: Position | None = None
        self.vote: Vote | None = None
        self._votes_opened = 0
        # Set once the match is over.
        self.result: MatchResult | None = None
        self._turn = 0
        self.timer = timer
        # None, like the clocks, in an untimed match.
        self._settings = timer_modes[timer]
        # The seconds each player had when their clock last stopped.
        self.clocks = (
            None
            if self._settings is None
            else dict.fromkeys(self.turn_order, self._settings.start_seconds)
        )
        # When the clock of the current player started, while it runs.
        self._running_since: float | None = None
        # When the choose clock runs out, while it runs. Unused time is lost.
        self._choose_deadline: float | None = None
        # Changes with the running deadline, so a stale timeout can be told.
        self.clock_epoch = 0
        self._start_clock()

    @property
    def current_player(self) -> str:
        return self.turn_order[self._turn]

    def time_left(self, player: str) -> float:
        """The seconds on a player's clock right now. Only for timed matches."""
        left = self.clocks[player]
        if self._running_since is not None and player == self.current_player:
            left -= self.clock() - self._running_since
        return max(0, left)

    def choose_time_left(self) -> float | None:
        """The seconds on the choose clock right now, if it is running."""
        if self._choose_deadline is None:
            return None
        return max(0, self._choose_deadline - self.clock())

    def clock_deadline(self) -> tuple[int, float] | None:
        """The epoch and the seconds left of the running clock, if one runs."""
        if self._running_since is not None:
            return self.clock_epoch, self.time_left(self.current_player)
        if self._choose_deadline is not None:
            return self.clock_epoch, self.choose_time_left()
        return None

    def expire_clock(self, epoch: int) -> TimedOut | AutoChosen | None:
        """Act on a clock that ran out, unless it is no longer the running one.

        It does not check the time: whoever calls it decides when it is due.
        """
        deadline = self.clock_deadline()
        if deadline is None or deadline[0] != epoch:
            return None
        player = self.current_player
        if self.phase is Phase.CHOOSE:
            self.choose(player, 0)
            return AutoChosen(player)
        self._stop_clock()
        self.clocks[player] = self._settings.start_seconds
        self._pass_turn()
        return TimedOut(player)

    def _start_clock(self) -> None:
        """Start the clock of the current player."""
        if self._settings is not None:
            self._running_since = self.clock()
            self.clock_epoch += 1

    def mark(self, player: str, row: object, col: object) -> None:
        self._check_turn(player)
        self._check_no_vote()
        if self.phase is Phase.CHOOSE:
            raise _move_error("choice_pending")
        if not (
            is_int_between(row, 0, len(self.board) - 1)
            and is_int_between(col, 0, len(self.board[0]) - 1)
        ):
            raise _move_error("cell_out_of_bounds")
        if self.board[row][col] is not None:
            raise _move_error("cell_taken")
        self._stop_clock()
        self.board[row][col] = Cell(player)
        self.last_move = (row, col)
        candidates = find_u_candidates(self.board, row, col, player)
        if len(candidates) > 1:
            self.phase = Phase.CHOOSE
            self.candidates = candidates
            self._start_choose_clock()
            return
        if candidates:
            self._score(player, candidates[0])
        self._finish_move(player)

    def choose(self, player: str, index: object) -> None:
        self._check_turn(player)
        self._check_no_vote()
        if self.phase is not Phase.CHOOSE:
            raise _move_error("no_choice_pending")
        if not is_int_between(index, 0, len(self.candidates) - 1):
            raise _move_error("invalid_choice")
        self._stop_clock()
        self._score(player, self.candidates[index])
        self._finish_move(player)

    def propose_end(self, player: str) -> None:
        self._check_turn(player)
        self._check_no_vote()
        if self.phase is Phase.CHOOSE:
            raise _move_error("choice_pending")
        if self.proposals_left[player] == 0:
            raise _move_error("no_proposals_left")
        self._stop_clock()
        self._votes_opened += 1
        self.vote = Vote(
            id=self._votes_opened,
            proposer=player,
            deadline=self.clock() + self.vote_seconds,
            votes={player: True},
        )

    def vote_end(self, player: str, end: object) -> FailedVote | None:
        if self.vote is None:
            raise _move_error("no_vote_pending")
        if player == self.vote.proposer:
            raise _move_error("proposer_cannot_vote")
        if player in self.vote.votes:
            raise _move_error("already_voted")
        if type(end) is not bool:
            raise _move_error("invalid_vote")
        self.vote.votes[player] = end
        return self._settle_vote()

    def expire_vote(self, vote_id: int) -> FailedVote | None:
        """Close a vote that ran out of time, unless it is already closed."""
        if self.vote is None or self.vote.id != vote_id:
            return None
        for player in self.remaining_players():
            self.vote.votes.setdefault(player, False)
        return self._settle_vote()

    def _settle_vote(self) -> FailedVote | None:
        """Close the open vote if its result can no longer change."""
        players = len(self.remaining_players())
        needed = players // 2 + 1
        to_end = sum(self.vote.votes.values())
        pending = players - len(self.vote.votes)
        if to_end >= needed:
            self.vote = None
            self._finish_by_score(EndReason.VOTE)
        elif to_end + pending < needed:
            return self._fail_vote(to_end, len(self.vote.votes) - to_end)
        return None

    def _fail_vote(self, end_votes: int, continue_votes: int) -> FailedVote:
        proposer, self.vote = self.vote.proposer, None
        for player in self.remaining_players():
            change = -1 if player == proposer else 1
            self.proposals_left[player] = min(
                self.proposals_left[player] + change, MAX_END_PROPOSALS
            )
        self._start_clock()
        return FailedVote(proposer, end_votes, continue_votes)

    def _start_choose_clock(self) -> None:
        if self._settings is not None:
            # Half the increment, rounded up, for each candidate beyond one.
            per_extra = math.ceil(self._settings.increment_seconds / 2)
            seconds = per_extra * (len(self.candidates) - 1)
            self._choose_deadline = self.clock() + seconds
            self.clock_epoch += 1

    def _stop_clock(self) -> None:
        """Stop whichever clock is running, if one is.

        The player keeps what is left on theirs. A choose clock is dropped.
        """
        if self._running_since is not None:
            self.clocks[self.current_player] = self.time_left(self.current_player)
            self._running_since = None
            self.clock_epoch += 1
        if self._choose_deadline is not None:
            self._choose_deadline = None
            self.clock_epoch += 1

    def _finish_move(self, player: str) -> None:
        """End a turn that ended with a move, which is what earns time."""
        if self._settings is not None:
            self.clocks[player] += self._settings.increment_seconds
        self._end_turn()

    def _score(self, player: str, u: Shape) -> None:
        for row, col in u:
            self.board[row][col] = Cell(player, disabled=True)
        self.scores[player] += 1

    def _end_turn(self) -> None:
        self.phase = Phase.MARK
        self.candidates = []
        if all(cell is not None for row in self.board for cell in row):
            self._finish_by_score(EndReason.BOARD_FULL)
            return
        self._pass_turn()

    def _pass_turn(self) -> None:
        """Give the turn to the next remaining player and start their clock."""
        self._turn = (self._turn + 1) % len(self.turn_order)
        while self.current_player in self.left:
            self._turn = (self._turn + 1) % len(self.turn_order)
        self._start_clock()

    def _finish_by_score(self, reason: EndReason) -> None:
        """The players still in with the highest score win."""
        remaining = self.remaining_players()
        best = max(self.scores[player] for player in remaining)
        winners = [player for player in remaining if self.scores[player] == best]
        self.result = MatchResult(winners, reason)

    def remaining_players(self) -> list[str]:
        """The players still in the match, in turn order."""
        return [player for player in self.turn_order if player not in self.left]

    def leave(self, player: str) -> FailedVote | None:
        """Take a player out, which can settle the open vote."""
        self.left.add(player)
        remaining = self.remaining_players()
        if len(remaining) == 1:
            self._stop_clock()
            self.vote = None
            self.result = MatchResult(remaining, EndReason.LAST_PLAYER)
        elif player == self.current_player:
            # A pending choice is dropped, so it scores nothing. An open vote
            # was proposed by this player, so it is cancelled.
            self._stop_clock()
            self.vote = None
            self._end_turn()
        elif self.vote is not None:
            self.vote.votes.pop(player, None)
            return self._settle_vote()
        return None

    def _check_turn(self, player: str) -> None:
        if player != self.current_player:
            raise _move_error("not_your_turn")

    def _check_no_vote(self) -> None:
        if self.vote is not None:
            raise _move_error("vote_pending")


def match_state(match: Match, viewer: str) -> dict[str, Any]:
    """The match as one player sees it: only the chooser gets the candidates."""
    state = {
        "board": _board_rows(match.board),
        "turnOrder": list(match.turn_order),
        "currentPlayer": match.current_player,
        "phase": match.phase.value,
        "scores": dict(match.scores),
        "leftPlayers": [name for name in match.turn_order if name in match.left],
        "lastMove": None if match.last_move is None else _position(match.last_move),
        "endProposalsLeft": dict(match.proposals_left),
        "vote": None if match.vote is None else _vote_state(match, viewer),
        "timer": match.timer.value,
        "clocks": _clocks_state(match),
        "chooseMsLeft": _milliseconds(match.choose_time_left()),
    }
    if match.phase is Phase.CHOOSE and viewer == match.current_player:
        state["candidates"] = [
            [_position(cell) for cell in u] for u in match.candidates
        ]
    return state


def _vote_state(match: Match, viewer: str) -> dict[str, Any]:
    """The open vote. Of the votes cast, only the viewer's own is revealed."""
    vote = match.vote
    own = vote.votes.get(viewer)
    return {
        "proposer": vote.proposer,
        "voted": len(vote.votes),
        "total": len(match.remaining_players()),
        "secondsLeft": max(0, math.ceil(vote.deadline - match.clock())),
        "yourVote": None if own is None else "end" if own else "continue",
    }


def _clocks_state(match: Match) -> dict[str, int] | None:
    if match.clocks is None:
        return None
    return {
        player: _milliseconds(match.time_left(player))
        for player in match.turn_order
    }


def _milliseconds(seconds: float | None) -> int | None:
    return None if seconds is None else round(seconds * 1000)


def game_over_payload(match: Match) -> dict[str, Any]:
    return {
        "winners": list(match.result.winners),
        "scores": dict(match.scores),
        "reason": match.result.reason.value,
        "board": _board_rows(match.board),
    }


def _board_rows(board: Board) -> list[list[dict[str, Any] | None]]:
    return [
        [None if cell is None else asdict(cell) for cell in row] for row in board
    ]


def _position(position: Position) -> dict[str, int]:
    row, col = position
    return {"row": row, "col": col}


def _move_error(code: str) -> ValidationError:
    # A move answers no form, so its errors name no field.
    return ValidationError(None, code)


_random = Random()


def get_random() -> Random:
    return _random


def get_vote_seconds() -> float:
    return VOTE_SECONDS


def get_timer_modes() -> Mapping[TimerMode, TimerSettings | None]:
    return TIMER_MODES
