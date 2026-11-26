import copy
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

import pytest

from app.games.board import Cell
from app.games.match import (
    AutoChosen,
    EndReason,
    FailedVote,
    Match,
    MatchResult,
    Phase,
    TimedOut,
    game_over_payload,
    match_state,
)
from app.games.models import TimerMode
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
        "endProposalsLeft": {"R": 2, "B": 2, "G": 2},
        "vote": None,
        "timer": "none",
        "clocks": None,
        "chooseMsLeft": None,
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


@dataclass
class FakeClock:
    """A clock the test moves by hand."""

    now: float = 1000.0

    def __call__(self) -> float:
        return self.now


def test_a_new_match_gives_every_player_two_end_proposals() -> None:
    match = make_match("....", "R", "B", "G")

    assert match.proposals_left == {"R": 2, "B": 2, "G": 2}


def test_a_match_accepts_a_clock_and_a_vote_duration() -> None:
    clock = FakeClock()

    match = Match(PLAYERS, 8, 8, FixedOrder(*PLAYERS), clock=clock, vote_seconds=5)

    assert (match.clock, match.vote_seconds) == (clock, 5)


def voting_match(*order: str) -> tuple[Match, FakeClock]:
    """A match on an empty board, with a fake clock and a 30-second vote."""
    order = order or ("R", "B", "G")
    clock = FakeClock()
    match = Match(order, 8, 8, FixedOrder(*order), clock=clock, vote_seconds=30)
    return match, clock


def test_a_proposal_opens_a_vote_with_the_proposer_voting_to_end() -> None:
    match, clock = voting_match()

    match.propose_end("R")

    assert match.vote.proposer == "R"
    assert match.vote.votes == {"R": True}
    assert match.vote.deadline == clock.now + 30
    assert (match.current_player, match.phase) == ("R", "mark")
    assert match.proposals_left == {"R": 2, "B": 2, "G": 2}


def test_each_vote_gets_a_new_id() -> None:
    match, _ = voting_match()
    match.propose_end("R")
    first = match.vote.id
    match.vote = None

    match.propose_end("R")

    assert match.vote.id != first


@pytest.mark.parametrize(
    ("player", "voting", "choosing", "attempts", "code"),
    [
        pytest.param("B", False, False, 2, "not_your_turn", id="out-of-turn"),
        pytest.param("R", True, False, 2, "vote_pending", id="vote-open"),
        pytest.param("R", False, True, 2, "choice_pending", id="choosing"),
        pytest.param("R", False, False, 0, "no_proposals_left", id="no-attempts"),
        pytest.param("B", True, True, 0, "not_your_turn", id="turn-first"),
        pytest.param("R", True, True, 0, "vote_pending", id="vote-second"),
        pytest.param("R", False, True, 0, "choice_pending", id="choice-third"),
    ],
)
def test_a_proposal_reports_only_the_first_broken_rule(
    player: str, voting: bool, choosing: bool, attempts: int, code: str
) -> None:
    match, _ = voting_match()
    if voting:
        match.propose_end("R")
    if choosing:
        match.phase = Phase.CHOOSE
    match.proposals_left = dict.fromkeys(match.turn_order, attempts)

    assert_rejected(match, code, lambda: match.propose_end(player))


@pytest.mark.parametrize("choosing", [False, True])
@pytest.mark.parametrize(
    "move",
    [
        pytest.param(lambda match, player: match.mark(player, 9, 9), id="mark"),
        pytest.param(lambda match, player: match.choose(player, 9), id="choose"),
    ],
)
def test_a_move_during_a_vote_is_rejected(choosing: bool, move: Any) -> None:
    match, _ = voting_match()
    match.propose_end("R")
    if choosing:
        # No vote opens during a choice: this only pins the order of the checks.
        match.phase = Phase.CHOOSE

    assert_rejected(match, "vote_pending", lambda: move(match, "R"))
    assert_rejected(match, "not_your_turn", lambda: move(match, "B"))


FOUR = ("R", "B", "G", "Y")


def proposed(*order: str) -> Match:
    """A match where the first player has just proposed ending it."""
    match, _ = voting_match(*order)
    match.propose_end(match.current_player)
    return match


def test_a_vote_that_stays_open_is_recorded_and_keeps_the_turn() -> None:
    match = proposed(*FOUR)

    assert match.vote_end("B", False) is None

    assert match.vote.votes == {"R": True, "B": False}
    assert match.result is None
    assert (match.current_player, match.phase) == ("R", "mark")


def test_a_majority_ends_the_match_at_once() -> None:
    match = proposed("R", "B", "G")

    match.vote_end("B", True)

    assert match.result is not None


@pytest.mark.parametrize(
    ("order", "votes"),
    [
        pytest.param(
            FOUR, [("B", True), ("G", False), ("Y", False)], id="tie"
        ),
        pytest.param(("R", "B"), [("B", False)], id="two-players-must-agree"),
        pytest.param(FOUR, [("B", False), ("G", False)], id="decided-early"),
    ],
)
def test_a_vote_that_cannot_reach_a_majority_closes(
    order: tuple[str, ...], votes: list[tuple[str, bool]]
) -> None:
    match = proposed(*order)

    for player, end in votes[:-1]:
        match.vote_end(player, end)
        assert match.vote is not None
    match.vote_end(*votes[-1])

    assert (match.vote, match.result) == (None, None)


def test_a_vote_without_an_open_one_is_rejected() -> None:
    match, _ = voting_match()

    assert_rejected(match, "no_vote_pending", lambda: match.vote_end("R", "yes"))


@pytest.mark.parametrize(
    ("player", "end", "code"),
    [
        pytest.param("R", "yes", "proposer_cannot_vote", id="proposer"),
        pytest.param("B", "yes", "already_voted", id="twice"),
        pytest.param("G", None, "invalid_vote", id="missing"),
        pytest.param("G", "yes", "invalid_vote", id="text"),
        pytest.param("G", 1, "invalid_vote", id="integer"),
        pytest.param("G", 0, "invalid_vote", id="zero"),
    ],
)
def test_a_vote_reports_only_the_first_broken_rule(
    player: str, end: object, code: str
) -> None:
    match = proposed(*FOUR)
    match.vote_end("B", False)

    assert_rejected(match, code, lambda: match.vote_end(player, end))


def test_a_failed_vote_is_reported_and_keeps_the_turn() -> None:
    match = proposed("R", "B", "G")
    match.vote_end("B", False)

    failed = match.vote_end("G", False)

    assert failed == FailedVote("R", end_votes=1, continue_votes=2)
    assert match.vote is None
    assert (match.current_player, match.phase) == ("R", "mark")


@pytest.mark.parametrize(
    ("before", "proposer", "after"),
    [
        pytest.param((2, 2, 2), "R", (1, 2, 2), id="proposer-spends-one"),
        pytest.param((1, 2, 2), "B", (2, 1, 2), id="another-gets-one-back"),
        pytest.param((0, 2, 2), "B", (1, 1, 2), id="recovers-from-zero"),
    ],
)
def test_a_failed_vote_moves_the_end_proposals(
    before: tuple[int, ...], proposer: str, after: tuple[int, ...]
) -> None:
    order = ("R", "B", "G")
    match, _ = voting_match(proposer, *(name for name in order if name != proposer))
    match.proposals_left = dict(zip(order, before))
    match.propose_end(proposer)

    for voter in order:
        if voter != proposer and match.vote is not None:
            match.vote_end(voter, False)

    assert match.proposals_left == dict(zip(order, after))


def test_a_player_who_left_gets_no_end_proposal_back() -> None:
    match, _ = voting_match("R", "B", "G")
    match.proposals_left["G"] = 1
    match.leave("G")
    match.propose_end("R")

    match.vote_end("B", False)

    assert match.proposals_left == {"R": 1, "B": 2, "G": 1}


def test_the_proposer_can_propose_again_on_the_same_turn() -> None:
    match = proposed("R", "B")
    match.vote_end("B", False)

    match.propose_end("R")
    match.vote_end("B", False)

    assert match.proposals_left == {"R": 0, "B": 2}
    assert_rejected(match, "no_proposals_left", lambda: match.propose_end("R"))


def test_a_vote_that_fails_early_counts_only_the_votes_cast() -> None:
    match = proposed(*FOUR)
    match.vote_end("B", False)

    assert match.vote_end("G", False) == FailedVote("R", 1, 2)


@pytest.mark.parametrize(
    ("scores", "left", "winners"),
    [
        pytest.param({"R": 1, "B": 0, "G": 3}, set(), ["G"], id="highest-score"),
        pytest.param({"R": 2, "B": 2, "G": 1}, set(), ["R", "B"], id="draw"),
        pytest.param({"R": 1, "B": 2, "G": 5}, {"G"}, ["B"], id="left-cannot-win"),
    ],
)
def test_a_passed_vote_gives_the_win_to_the_highest_score(
    scores: dict[str, int], left: set[str], winners: list[str]
) -> None:
    match, _ = voting_match("R", "B", "G")
    match.scores = dict(scores)
    for player in left:
        match.leave(player)
    match.propose_end("R")

    assert match.vote_end("B", True) is None

    assert match.result == MatchResult(winners, EndReason.VOTE)
    assert match.vote is None
    assert match.proposals_left == {"R": 2, "B": 2, "G": 2}


def test_an_expired_vote_counts_the_missing_votes_as_continue() -> None:
    match = proposed("R", "B", "G")

    failed = match.expire_vote(match.vote.id)

    assert failed == FailedVote("R", end_votes=1, continue_votes=2)
    assert match.vote is None
    assert match.proposals_left == {"R": 1, "B": 2, "G": 2}
    assert (match.current_player, match.phase) == ("R", "mark")


def test_expiring_an_old_vote_changes_nothing() -> None:
    match = proposed("R", "B")
    old = match.vote.id
    match.vote_end("B", False)
    match.propose_end("R")
    before = copy.deepcopy(vars(match))

    assert match.expire_vote(old) is None

    assert vars(match) == before


def test_expiring_with_no_vote_open_changes_nothing() -> None:
    match = proposed("R", "B")
    old = match.vote.id
    match.vote_end("B", False)
    before = copy.deepcopy(vars(match))

    assert match.expire_vote(old) is None

    assert vars(match) == before


def test_a_leaving_voter_can_make_the_vote_pass() -> None:
    match = proposed(*FOUR)
    match.vote_end("B", True)
    match.vote_end("G", False)

    assert match.leave("G") is None

    assert match.vote is None
    assert match.result == MatchResult(["R", "B", "Y"], EndReason.VOTE)


def test_a_leaving_voter_can_make_the_vote_fail() -> None:
    match = proposed("R", "B", "G")
    match.vote_end("B", False)

    # With two players left, both must agree, and "B" did not.
    failed = match.leave("G")

    assert failed == FailedVote("R", end_votes=1, continue_votes=1)
    assert match.vote is None
    assert match.proposals_left == {"R": 1, "B": 2, "G": 2}
    assert match.current_player == "R"


def test_a_leaving_voter_leaves_the_vote_open_with_a_smaller_total() -> None:
    match = proposed(*FOUR)
    match.vote_end("B", False)

    assert match.leave("B") is None

    assert match.vote.votes == {"R": True}
    assert match.remaining_players() == ["R", "G", "Y"]
    assert match.result is None


def test_a_leaving_proposer_cancels_the_vote() -> None:
    match = proposed("R", "B", "G")

    assert match.leave("R") is None

    assert (match.vote, match.result) == (None, None)
    assert match.proposals_left == {"R": 2, "B": 2, "G": 2}
    assert match.current_player == "B"


@pytest.mark.parametrize("leaver", ["R", "B"])
def test_the_last_player_during_a_vote_wins_as_last_standing(leaver: str) -> None:
    match = proposed("R", "B")
    (survivor,) = {"R", "B"} - {leaver}

    assert match.leave(leaver) is None

    assert match.result == MatchResult([survivor], EndReason.LAST_PLAYER)
    assert match.vote is None


def test_the_state_has_the_end_proposals_and_no_vote() -> None:
    match, _ = voting_match("R", "B")
    match.proposals_left["B"] = 1

    state = match_state(match, "R")

    assert state["endProposalsLeft"] == {"R": 2, "B": 1}
    assert state["vote"] is None


@pytest.mark.parametrize(
    ("viewer", "own_vote"), [("R", "end"), ("B", "continue"), ("G", None)]
)
def test_the_state_describes_the_open_vote_without_the_others_votes(
    viewer: str, own_vote: str | None
) -> None:
    match = proposed(*FOUR)
    match.vote_end("B", False)

    # An exact match, so nothing else can reveal what somebody voted.
    assert match_state(match, viewer)["vote"] == {
        "proposer": "R",
        "voted": 2,
        "total": 4,
        "secondsLeft": 30,
        "yourVote": own_vote,
    }


def test_the_vote_total_counts_only_the_players_still_in() -> None:
    match = proposed(*FOUR)
    match.leave("Y")

    vote = match_state(match, "R")["vote"]

    assert (vote["voted"], vote["total"]) == (1, 3)


@pytest.mark.parametrize(
    ("elapsed", "left"), [(0, 30), (0.1, 30), (1, 29), (29.5, 1), (30, 0), (45, 0)]
)
def test_the_seconds_left_are_rounded_up_and_never_negative(
    elapsed: float, left: int
) -> None:
    match, clock = voting_match()
    match.propose_end("R")

    clock.now += elapsed

    assert match_state(match, "R")["vote"]["secondsLeft"] == left


def test_the_game_over_payload_reports_a_vote() -> None:
    match = proposed("R", "B")

    match.vote_end("B", True)

    assert game_over_payload(match)["reason"] == "vote"


def timed_match(
    mode: TimerMode = TimerMode.NORMAL, *order: str
) -> tuple[Match, FakeClock]:
    """A timed match on an empty 12 x 8 board, with a fake clock."""
    order = order or ("Ana", "Esteban", "Luis")
    clock = FakeClock()
    match = Match(order, 12, 8, FixedOrder(*order), clock=clock, timer=mode)
    return match, clock


def times(match: Match) -> dict[str, float]:
    return {player: match.time_left(player) for player in match.turn_order}


def test_every_player_starts_with_the_time_of_the_mode() -> None:
    match, _ = timed_match()

    assert times(match) == {"Ana": 30, "Esteban": 30, "Luis": 30}


def test_only_the_clock_of_the_first_player_runs_at_the_start() -> None:
    match, clock = timed_match()

    clock.now += 4

    assert times(match) == {"Ana": 26, "Esteban": 30, "Luis": 30}


def test_a_clock_never_shows_less_than_zero() -> None:
    match, clock = timed_match()

    clock.now += 31

    assert match.time_left("Ana") == 0


def test_an_untimed_match_has_no_clocks() -> None:
    match, _ = voting_match()

    assert match.clocks is None


def test_a_finished_turn_takes_the_time_used_and_adds_the_increment() -> None:
    match, clock = timed_match()

    clock.now += 4
    match.mark("Ana", 0, 0)

    assert match.time_left("Ana") == 36


def test_the_next_player_clock_starts_after_a_move() -> None:
    match, clock = timed_match()
    clock.now += 4
    match.mark("Ana", 0, 0)

    clock.now += 7

    assert times(match) == {"Ana": 36, "Esteban": 23, "Luis": 30}


def test_a_mark_that_scores_one_u_adds_the_increment() -> None:
    match, clock = timed_match()
    for row, col in [(0, 0), (1, 0), (1, 1), (1, 2)]:
        match.board[row][col] = Cell("Ana")

    clock.now += 4
    match.mark("Ana", 0, 2)

    assert match.scores["Ana"] == 1
    assert match.time_left("Ana") == 36


def test_a_clock_has_no_upper_limit() -> None:
    match, clock = timed_match(TimerMode.SLOW)
    match.clocks["Ana"] = 120

    clock.now += 3
    match.mark("Ana", 0, 0)

    assert match.time_left("Ana") == 132


def test_a_rejected_mark_leaves_the_clock_running() -> None:
    match, clock = timed_match()
    clock.now += 4

    with pytest.raises(ValidationError):
        match.mark("Ana", 99, 0)
    clock.now += 1

    assert match.time_left("Ana") == 25


def test_filling_the_board_stops_every_clock() -> None:
    match, clock = timed_match(TimerMode.NORMAL, "R", "B")
    match.board = parse_board("B.")
    match.mark("R", 0, 1)
    stopped = times(match)

    clock.now += 100

    assert match.result is not None
    assert times(match) == stopped


def proposal_at_21_seconds() -> tuple[Match, FakeClock]:
    """A two-player timed match where the proposer has used 9 of 30 seconds."""
    match, clock = timed_match(TimerMode.NORMAL, "Esteban", "Ana")
    clock.now += 9
    match.propose_end("Esteban")
    return match, clock


def test_an_open_vote_freezes_the_proposer_clock() -> None:
    match, clock = proposal_at_21_seconds()

    clock.now += 12

    assert match.time_left("Esteban") == 21


@pytest.mark.parametrize("expires", [False, True])
def test_a_failed_vote_resumes_the_proposer_clock(expires: bool) -> None:
    match, clock = proposal_at_21_seconds()
    clock.now += 12

    if expires:
        match.expire_vote(match.vote.id)
    else:
        match.vote_end("Ana", False)
    clock.now += 1

    assert match.time_left("Esteban") == 20


def test_a_passed_vote_leaves_no_clock_running() -> None:
    match, clock = proposal_at_21_seconds()
    match.vote_end("Ana", True)

    clock.now += 5

    assert match.result is not None
    assert times(match) == {"Esteban": 21, "Ana": 30}


def luis_leaves_before_ana() -> tuple[Match, FakeClock]:
    """It is Luis's turn, 6 seconds in, and Ana, who is next, has 25 seconds."""
    match, clock = timed_match(TimerMode.NORMAL, "Luis", "Ana", "Esteban")
    match.clocks["Ana"] = 25
    clock.now += 6
    return match, clock


def test_the_next_clock_starts_when_the_current_player_leaves() -> None:
    match, clock = luis_leaves_before_ana()

    match.leave("Luis")
    clock.now += 3

    assert match.current_player == "Ana"
    assert match.time_left("Ana") == 22


def test_a_player_who_leaves_gains_no_increment() -> None:
    match, clock = luis_leaves_before_ana()

    match.leave("Luis")
    clock.now += 3

    assert match.time_left("Luis") == 24


def test_another_player_leaving_does_not_disturb_the_running_clock() -> None:
    match, clock = luis_leaves_before_ana()

    match.leave("Esteban")
    clock.now += 4

    assert match.time_left("Luis") == 20


def test_the_clocks_stop_when_only_one_player_is_left() -> None:
    match, clock = timed_match(TimerMode.NORMAL, "Ana", "Esteban")
    clock.now += 6

    match.leave("Esteban")
    clock.now += 10

    assert times(match) == {"Ana": 24, "Esteban": 30}


def test_the_deadline_is_the_time_left_to_the_current_player() -> None:
    match, clock = timed_match()
    clock.now += 4

    assert match.clock_deadline() == (match.clock_epoch, 26)


def new_epoch(match: Match, change: Callable[[], object]) -> bool:
    before = match.clock_epoch
    change()
    return match.clock_epoch != before


def test_the_epoch_changes_when_a_turn_starts() -> None:
    match, _ = timed_match()

    assert new_epoch(match, lambda: match.mark("Ana", 0, 0))
    assert match.clock_deadline() == (match.clock_epoch, 30)


def test_the_epoch_changes_when_the_choose_phase_starts() -> None:
    match, _ = timed_match(TimerMode.NORMAL, "R", "B")
    match.board = parse_board(TWO_US)

    assert new_epoch(match, lambda: match.mark("R", 1, 2))
    assert match.phase is Phase.CHOOSE


def test_the_epoch_changes_when_a_vote_opens_and_closes() -> None:
    match, _ = timed_match()

    assert new_epoch(match, lambda: match.propose_end("Ana"))
    assert match.clock_deadline() is None
    match.vote_end("Esteban", False)
    assert new_epoch(match, lambda: match.vote_end("Luis", False))
    assert match.clock_deadline() == (match.clock_epoch, 30)


def test_the_epoch_changes_when_the_current_player_leaves() -> None:
    match, _ = timed_match()

    assert new_epoch(match, lambda: match.leave("Ana"))


def test_an_untimed_match_has_no_deadline() -> None:
    match, _ = voting_match()

    assert match.clock_deadline() is None


def test_a_finished_match_has_no_deadline() -> None:
    match, _ = timed_match(TimerMode.NORMAL, "Ana", "Esteban")

    match.leave("Esteban")

    assert match.clock_deadline() is None


def expire(match: Match) -> object:
    """Run out the clock that is running now."""
    return match.expire_clock(match.clock_epoch)


def test_a_timeout_passes_the_turn_without_a_mark() -> None:
    match, clock = timed_match(TimerMode.FAST)
    clock.now += 10.5

    assert expire(match) == TimedOut("Ana")

    assert all(cell is None for row in match.board for cell in row)
    assert match.last_move is None
    assert (match.current_player, match.phase) == ("Esteban", "mark")


@pytest.mark.parametrize("banked", [2, 200])
def test_a_timeout_resets_the_clock_to_the_starting_time(banked: int) -> None:
    match, clock = timed_match(TimerMode.SLOW)
    match.clocks["Ana"] = banked
    clock.now += banked + 0.5

    expire(match)

    assert match.time_left("Ana") == 60


def test_the_next_clock_starts_after_a_timeout() -> None:
    match, clock = timed_match()
    clock.now += 30
    expire(match)

    clock.now += 4

    assert times(match) == {"Ana": 30, "Esteban": 26, "Luis": 30}


def test_a_timeout_skips_a_player_who_left() -> None:
    match, _ = timed_match()
    match.leave("Esteban")

    expire(match)

    assert match.current_player == "Luis"


def test_a_stale_timeout_changes_nothing() -> None:
    match, clock = timed_match()
    stale = match.clock_epoch
    match.mark("Ana", 0, 0)
    clock.now += 3

    assert match.expire_clock(stale) is None

    assert match.current_player == "Esteban"
    assert times(match) == {"Ana": 40, "Esteban": 27, "Luis": 30}


def test_no_clock_runs_out_during_a_vote() -> None:
    match, _ = timed_match()
    match.propose_end("Ana")

    assert expire(match) is None
    assert match.current_player == "Ana"


# Marking (1, 3) completes three Us.
THREE_US = "......./.R.?RR./.RRRRR."
MARKS = {TWO_US: (1, 2), THREE_US: (1, 3)}


def timed_choice(
    mode: TimerMode, grid: str = TWO_US, banked: float | None = None
) -> tuple[Match, FakeClock]:
    """A timed match where "R" has just marked into a choice."""
    match, clock = timed_match(mode, "R", "B")
    match.board = parse_board(grid)
    if banked is not None:
        match.clocks["R"] = banked
    match.mark("R", *MARKS[grid])
    assert match.phase is Phase.CHOOSE
    return match, clock


@pytest.mark.parametrize(
    ("mode", "grid", "seconds"),
    [
        pytest.param(TimerMode.NORMAL, TWO_US, 5, id="two-on-normal"),
        pytest.param(TimerMode.SLOW, THREE_US, 16, id="three-on-slow"),
        pytest.param(TimerMode.FAST, TWO_US, 3, id="two-on-fast"),
    ],
)
def test_the_choose_clock_depends_on_the_mode_and_the_candidates(
    mode: TimerMode, grid: str, seconds: int
) -> None:
    match, _ = timed_choice(mode, grid)

    assert len(match.candidates) == (3 if grid == THREE_US else 2)
    assert match.choose_time_left() == seconds
    assert match.clock_deadline() == (match.clock_epoch, seconds)


def test_the_player_clock_stops_while_choosing() -> None:
    match, clock = timed_choice(TimerMode.NORMAL, banked=18)

    clock.now += 2

    assert match.time_left("R") == 18
    assert match.choose_time_left() == 3


def test_unused_choose_time_is_lost() -> None:
    match, clock = timed_choice(TimerMode.NORMAL, THREE_US, banked=18)
    assert match.choose_time_left() == 10
    clock.now += 2

    match.choose("R", 0)

    assert match.time_left("R") == 28
    assert match.choose_time_left() is None
    assert match.clock_deadline() == (match.clock_epoch, 30)


def test_there_is_no_choose_clock_in_an_untimed_match() -> None:
    match = choosing_match()

    assert match.choose_time_left() is None
    assert match.clock_deadline() is None


def test_leaving_during_a_choice_drops_the_choose_clock() -> None:
    match, clock = timed_match(TimerMode.NORMAL, "R", "B", "G")
    match.board = parse_board(TWO_US)
    match.mark("R", 1, 2)

    match.leave("R")
    clock.now += 3

    assert match.choose_time_left() is None
    assert match.clock_deadline() == (match.clock_epoch, 27)
    assert match.current_player == "B"


def test_the_first_candidate_is_chosen_when_the_choose_clock_runs_out() -> None:
    match, clock = timed_choice(TimerMode.FAST, banked=6)
    match.scores["R"] = 1
    first = set(match.candidates[0])
    clock.now += 3.5

    assert expire(match) == AutoChosen("R")

    assert disabled_cells(match) == first
    assert match.scores == {"R": 2, "B": 0}
    assert match.time_left("R") == 11
    assert (match.current_player, match.phase) == ("B", "mark")
    assert match.candidates == []
    assert match.choose_time_left() is None


def clock_fields(match: Match) -> tuple[object, object, object]:
    state = match_state(match, match.turn_order[0])
    return state["timer"], state["clocks"], state["chooseMsLeft"]


def test_the_state_has_the_clocks_in_milliseconds_as_of_now() -> None:
    match, clock = timed_match(TimerMode.NORMAL, "Ana", "Esteban")

    clock.now += 4.0004

    assert clock_fields(match) == (
        "normal",
        {"Ana": 26000, "Esteban": 30000},
        None,
    )
    assert all(type(ms) is int for ms in clock_fields(match)[1].values())


def test_the_state_has_the_choose_clock_while_it_runs() -> None:
    match, clock = timed_choice(TimerMode.NORMAL, banked=18)

    clock.now += 1.5

    assert clock_fields(match) == ("normal", {"R": 18000, "B": 30000}, 3500)


def test_the_state_of_an_untimed_match_has_no_clocks() -> None:
    match, _ = voting_match()

    assert clock_fields(match) == ("none", None, None)
