import copy
from typing import Any

import pytest

from app.games.board import Cell
from app.games.match import (
    EndReason,
    Match,
    MatchResult,
    Phase,
    game_over_payload,
    match_state,
)
from app.games.validation import ValidationError
from tests.games.boards import parse_board
from tests.games.randomness import FixedOrder

PLAYERS = ["Esteban", "Ana", "Luis"]


def test_a_new_match_starts_empty_with_a_random_turn_order() -> None:
    match = Match(PLAYERS, width=12, height=10, rng=FixedOrder("Ana", "Luis", "Esteban"))

    assert match.board == [[None] * 12 for _ in range(10)]
    assert match.turn_order == ["Ana", "Luis", "Esteban"]
    assert match.current_player == "Ana"
    assert match.phase == "mark"
    assert match.scores == {"Ana": 0, "Luis": 0, "Esteban": 0}
    assert match.left == set()
    assert match.last_move is None
    assert match.result is None
    assert PLAYERS == ["Esteban", "Ana", "Luis"]  # the input is not shuffled


def make_match(grid: str, *order: str) -> Match:
    """A match on the given board, with turns in the given order."""
    board = parse_board(grid)
    order = order or ("R", "B")
    match = Match(order, len(board[0]), len(board), FixedOrder(*order))
    match.board = board
    return match


def assert_rejected(match: Match, code: str, move: Any) -> None:
    before = copy.deepcopy(vars(match))

    with pytest.raises(ValidationError) as excinfo:
        move()

    assert (excinfo.value.code, excinfo.value.field) == (code, None)
    assert vars(match) == before


def test_a_valid_mark_takes_the_cell_and_is_remembered() -> None:
    match = make_match("..../....")

    match.mark("R", 1, 3)

    assert match.board[1][3] == Cell("R")
    assert match.last_move == (1, 3)


@pytest.mark.parametrize(
    ("row", "col"),
    [
        (-1, 0), (0, -1), (2, 0), (0, 4), (None, 0), (0, None),
        ("0", 0), (0, 1.0), (True, 0), (0, False),
    ],
)  # fmt: skip
def test_a_mark_outside_the_board_is_rejected(row: object, col: object) -> None:
    match = make_match("..../....")

    assert_rejected(match, "cell_out_of_bounds", lambda: match.mark("R", row, col))


@pytest.mark.parametrize(
    "grid",
    [
        pytest.param("B...", id="owned"),
        pytest.param("R...", id="own"),
        pytest.param("b...", id="disabled"),
        pytest.param("L...", id="of-a-player-who-left"),
    ],
)
def test_a_cell_that_is_not_empty_is_rejected(grid: str) -> None:
    match = make_match(grid, "R", "B", "L")
    match.left.add("L")

    assert_rejected(match, "cell_taken", lambda: match.mark("R", 0, 0))


def test_a_mark_out_of_turn_is_rejected() -> None:
    match = make_match("....")

    assert_rejected(match, "not_your_turn", lambda: match.mark("B", 0, 0))


def test_a_mark_during_a_choice_is_rejected() -> None:
    match = make_match("....")
    match.phase = Phase.CHOOSE

    assert_rejected(match, "choice_pending", lambda: match.mark("R", 0, 0))


@pytest.mark.parametrize(
    ("player", "choosing", "row", "code"),
    [
        ("B", True, 9, "not_your_turn"),
        ("R", True, 9, "choice_pending"),
        ("R", False, 9, "cell_out_of_bounds"),
    ],
)
def test_only_the_first_broken_rule_is_reported(
    player: str, choosing: bool, row: int, code: str
) -> None:
    match = make_match("B...")
    if choosing:
        match.phase = Phase.CHOOSE

    assert_rejected(match, code, lambda: match.mark(player, row, 0))


def disabled_cells(match: Match) -> set[tuple[int, int]]:
    return {
        (row, col)
        for row, cells in enumerate(match.board)
        for col, cell in enumerate(cells)
        if cell is not None and cell.disabled
    }


# Marking (1, 2) completes two Us, one on each side.
TWO_US = "R.R.R/RR?RR/....."
LEFT_U = {(0, 0), (0, 2), (1, 0), (1, 1), (1, 2)}
RIGHT_U = {(0, 2), (0, 4), (1, 2), (1, 3), (1, 4)}


def test_a_mark_without_a_u_passes_the_turn() -> None:
    match = make_match("....")

    match.mark("R", 0, 0)

    assert match.scores == {"R": 0, "B": 0}
    assert match.current_player == "B"
    assert match.phase == "mark"


def test_a_single_u_is_scored_at_once() -> None:
    match = make_match("R../RRR/...")

    match.mark("R", 0, 2)

    assert match.scores == {"R": 1, "B": 0}
    assert disabled_cells(match) == {(0, 0), (0, 2), (1, 0), (1, 1), (1, 2)}
    assert match.board[0][2] == Cell("R", disabled=True)
    assert match.current_player == "B"
    assert match.phase == "mark"


def test_several_us_start_a_choice_and_keep_the_turn() -> None:
    match = make_match(TWO_US)

    match.mark("R", 1, 2)

    assert match.phase == "choose"
    found = [set(cells) for cells in match.candidates]
    assert len(found) == 2 and LEFT_U in found and RIGHT_U in found
    assert match.current_player == "R"
    assert match.scores == {"R": 0, "B": 0}
    assert disabled_cells(match) == set()


def test_a_disabled_cell_is_never_used_in_another_u() -> None:
    # (1, 2) already scored; only it could complete the U that opens up.
    match = make_match("R../RRr/.../...")
    match.board[0][2] = None

    match.mark("R", 0, 2)

    assert match.scores["R"] == 0


def choosing_match() -> Match:
    match = make_match(TWO_US)
    match.mark("R", 1, 2)
    return match


@pytest.mark.parametrize("index", [0, 1])
def test_choosing_a_u_scores_only_that_candidate(index: int) -> None:
    match = choosing_match()
    chosen = set(match.candidates[index])

    match.choose("R", index)

    assert disabled_cells(match) == chosen
    assert match.scores == {"R": 1, "B": 0}
    assert match.current_player == "B"
    assert match.phase == "mark"
    assert match.candidates == []


def test_a_choice_out_of_turn_is_rejected() -> None:
    match = choosing_match()

    assert_rejected(match, "not_your_turn", lambda: match.choose("B", 0))


def test_a_choice_without_a_pending_one_is_rejected() -> None:
    match = make_match("....")

    assert_rejected(match, "no_choice_pending", lambda: match.choose("R", 0))


@pytest.mark.parametrize("index", [-1, 2, None, "0", 0.0, True, False])
def test_an_invalid_index_is_rejected(index: object) -> None:
    match = choosing_match()

    assert_rejected(match, "invalid_choice", lambda: match.choose("R", index))


def test_the_turn_skips_players_who_left_and_wraps_around() -> None:
    match = make_match("....", "R", "B", "G")
    match.left.add("B")

    match.mark("R", 0, 0)
    assert match.current_player == "G"

    match.mark("G", 0, 1)
    assert match.current_player == "R"
    assert match.result is None


@pytest.mark.parametrize(
    ("scores", "left", "winners"),
    [
        pytest.param({"R": 4, "B": 2, "G": 0}, set(), ["R"], id="clear-winner"),
        pytest.param({"R": 3, "B": 3, "G": 1}, set(), ["R", "B"], id="draw"),
        pytest.param({"R": 1, "B": 3, "G": 5}, {"G"}, ["B"], id="left-cannot-win"),
    ],
)
def test_filling_the_last_cell_ends_the_match(
    scores: dict[str, int], left: set[str], winners: list[str]
) -> None:
    match = make_match("BBG.", "R", "B", "G")
    match.scores = dict(scores)
    match.left = set(left)

    match.mark("R", 0, 3)

    assert match.result == MatchResult(winners, EndReason.BOARD_FULL)


def test_a_last_mark_with_two_us_is_chosen_before_the_end() -> None:
    match = make_match("RBRBR/RR?RR")

    match.mark("R", 1, 2)
    assert (match.phase, match.result) == ("choose", None)

    match.choose("R", 0)
    assert match.result == MatchResult(["R"], EndReason.BOARD_FULL)


def test_a_player_who_leaves_keeps_their_cells_and_score() -> None:
    match = make_match("G...", "R", "B", "G")
    match.scores["G"] = 2

    match.leave("G")

    assert match.left == {"G"}
    assert match.board[0][0] == Cell("G")
    assert match.scores["G"] == 2
    assert match.current_player == "R"
    assert match.result is None


def test_the_turn_passes_when_its_player_leaves() -> None:
    match = make_match("....", "R", "B", "G")

    match.leave("R")

    assert match.current_player == "B"


def test_a_player_who_leaves_while_choosing_scores_nothing() -> None:
    match = make_match(TWO_US, "R", "B", "G")
    match.scores["R"] = 2
    match.mark("R", 1, 2)

    match.leave("R")

    assert match.scores["R"] == 2
    assert disabled_cells(match) == set()
    assert (match.phase, match.candidates) == ("mark", [])
    assert match.current_player == "B"


@pytest.mark.parametrize("leavers", [["B", "G"], ["G", "R"]])
def test_the_last_player_standing_wins_whatever_the_scores(
    leavers: list[str],
) -> None:
    match = make_match("....", "R", "B", "G")
    (survivor,) = {"R", "B", "G"} - set(leavers)
    match.scores = {player: 3 for player in leavers} | {survivor: 0}

    for leaver in leavers:
        match.leave(leaver)

    assert match.result == MatchResult([survivor], EndReason.LAST_PLAYER)


def test_leaving_a_choice_on_a_full_board_ends_the_match() -> None:
    match = make_match("RBRBR/RR?RR", "R", "B", "G")
    match.scores = {"R": 5, "B": 1, "G": 0}
    match.mark("R", 1, 2)

    match.leave("R")

    assert match.result == MatchResult(["B"], EndReason.BOARD_FULL)


def test_the_state_describes_the_whole_match() -> None:
    match = make_match("r.G.", "R", "B", "G")
    match.scores["R"] = 1
    match.leave("G")
    match.mark("R", 0, 1)

    assert match_state(match, "R") == {
        "board": [
            [
                {"owner": "R", "disabled": True},
                {"owner": "R", "disabled": False},
                {"owner": "G", "disabled": False},
                None,
            ]
        ],
        "turnOrder": ["R", "B", "G"],
        "currentPlayer": "B",
        "phase": "mark",
        "scores": {"R": 1, "B": 0, "G": 0},
        "leftPlayers": ["G"],
        "lastMove": {"row": 0, "col": 1},
    }


def test_a_new_state_has_empty_cells_and_no_last_move() -> None:
    state = match_state(make_match(".."), "R")

    assert state["board"] == [[None, None]]
    assert state["lastMove"] is None


def test_only_the_choosing_player_sees_the_candidates() -> None:
    match = choosing_match()

    candidates = match_state(match, "R")["candidates"]

    assert candidates == [
        [{"row": row, "col": col} for row, col in u] for u in match.candidates
    ]
    assert [len(u) for u in candidates] == [5, 5]
    assert "candidates" not in match_state(match, "B")


def test_no_candidates_are_sent_outside_a_choice() -> None:
    assert "candidates" not in match_state(make_match(".."), "R")


def test_the_game_over_payload_describes_the_result() -> None:
    match = make_match("B.")
    match.scores["B"] = 2

    match.mark("R", 0, 1)

    assert game_over_payload(match) == {
        "winners": ["B"],
        "scores": {"R": 0, "B": 2},
        "reason": "board_full",
        "board": match_state(match, "R")["board"],
    }
