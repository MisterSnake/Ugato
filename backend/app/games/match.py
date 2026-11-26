"""The state of a started game and the rules that change it.

Nothing here knows about connections.
"""

from collections.abc import Sequence
from dataclasses import asdict, dataclass
from enum import StrEnum
from random import Random
from typing import Any

from app.games.board import Board, Cell, Position, Shape, find_u_candidates
from app.games.validation import ValidationError, is_int_between


class Phase(StrEnum):
    MARK = "mark"
    CHOOSE = "choose"


class EndReason(StrEnum):
    BOARD_FULL = "board_full"
    LAST_PLAYER = "last_player"


@dataclass(frozen=True)
class MatchResult:
    winners: list[str]
    reason: EndReason


class Match:
    def __init__(
        self, players: Sequence[str], width: int, height: int, rng: Random
    ) -> None:
        self.board: Board = [[None] * width for _ in range(height)]
        self.turn_order = list(players)
        rng.shuffle(self.turn_order)
        self.phase = Phase.MARK
        self.candidates: list[Shape] = []
        self.scores = dict.fromkeys(self.turn_order, 0)
        self.left: set[str] = set()
        self.last_move: Position | None = None
        # Set once the match is over.
        self.result: MatchResult | None = None
        self._turn = 0

    @property
    def current_player(self) -> str:
        return self.turn_order[self._turn]

    def mark(self, player: str, row: object, col: object) -> None:
        self._check_turn(player)
        if self.phase is Phase.CHOOSE:
            raise _move_error("choice_pending")
        if not (
            is_int_between(row, 0, len(self.board) - 1)
            and is_int_between(col, 0, len(self.board[0]) - 1)
        ):
            raise _move_error("cell_out_of_bounds")
        if self.board[row][col] is not None:
            raise _move_error("cell_taken")
        self.board[row][col] = Cell(player)
        self.last_move = (row, col)
        candidates = find_u_candidates(self.board, row, col, player)
        if len(candidates) > 1:
            self.phase = Phase.CHOOSE
            self.candidates = candidates
            return
        if candidates:
            self._score(player, candidates[0])
        self._end_turn()

    def choose(self, player: str, index: object) -> None:
        self._check_turn(player)
        if self.phase is not Phase.CHOOSE:
            raise _move_error("no_choice_pending")
        if not is_int_between(index, 0, len(self.candidates) - 1):
            raise _move_error("invalid_choice")
        self._score(player, self.candidates[index])
        self._end_turn()

    def _score(self, player: str, u: Shape) -> None:
        for row, col in u:
            self.board[row][col] = Cell(player, disabled=True)
        self.scores[player] += 1

    def _end_turn(self) -> None:
        self.phase = Phase.MARK
        self.candidates = []
        if all(cell is not None for row in self.board for cell in row):
            self._finish_full_board()
            return
        self._turn = (self._turn + 1) % len(self.turn_order)
        while self.current_player in self.left:
            self._turn = (self._turn + 1) % len(self.turn_order)

    def _finish_full_board(self) -> None:
        remaining = self.remaining_players()
        best = max(self.scores[player] for player in remaining)
        winners = [player for player in remaining if self.scores[player] == best]
        self.result = MatchResult(winners, EndReason.BOARD_FULL)

    def remaining_players(self) -> list[str]:
        """The players still in the match, in turn order."""
        return [player for player in self.turn_order if player not in self.left]

    def leave(self, player: str) -> None:
        self.left.add(player)
        remaining = self.remaining_players()
        if len(remaining) == 1:
            self.result = MatchResult(remaining, EndReason.LAST_PLAYER)
        elif player == self.current_player:
            # A pending choice is dropped, so it scores nothing.
            self._end_turn()

    def _check_turn(self, player: str) -> None:
        if player != self.current_player:
            raise _move_error("not_your_turn")


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
    }
    if match.phase is Phase.CHOOSE and viewer == match.current_player:
        state["candidates"] = [
            [_position(cell) for cell in u] for u in match.candidates
        ]
    return state


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
