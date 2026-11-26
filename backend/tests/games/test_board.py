import pytest

from app.games.board import find_u_candidates
from tests.games.boards import parse_board

SHAPES = {
    "up": ["R.R", "RRR"],
    "down": ["RRR", "R.R"],
    "left": ["RR", ".R", "RR"],
    "right": ["RR", "R.", "RR"],
}


def cells_of(rows: list[str], top: int = 0, left: int = 0) -> list[tuple[int, int]]:
    return sorted(
        (top + row, left + col)
        for row, line in enumerate(rows)
        for col, char in enumerate(line)
        if char == "R"
    )


@pytest.mark.parametrize(
    ("rows", "marked"),
    [
        pytest.param(rows, marked, id=f"{name}-{marked}")
        for name, rows in SHAPES.items()
        for marked in cells_of(rows)
    ],
)
def test_finds_each_orientation_through_each_of_its_cells(
    rows: list[str], marked: tuple[int, int]
) -> None:
    board = parse_board("/".join(rows))

    assert find_u_candidates(board, *marked, "R") == [tuple(cells_of(rows))]


def test_finds_a_u_away_from_the_edges() -> None:
    board = parse_board("...../.R.R./.RRR./.....")

    assert find_u_candidates(board, 2, 2, "R") == [
        ((1, 1), (1, 3), (2, 1), (2, 2), (2, 3))
    ]


@pytest.mark.parametrize("notch", [".", "R", "B", "r", "b"])
def test_the_notch_is_never_checked(notch: str) -> None:
    board = parse_board(f"R{notch}R/RRR")

    found = find_u_candidates(board, 1, 1, "R")

    assert tuple(cells_of(SHAPES["up"])) in found


@pytest.mark.parametrize(
    "grid",
    [
        pytest.param("R.B/RRR", id="another-players-cell"),
        pytest.param("R.R/RrR", id="disabled-cell"),
        pytest.param("R../RRR", id="missing-cell"),
        pytest.param("RRR", id="arms-off-the-board"),
        pytest.param("R./RR", id="side-off-the-board"),
    ],
)
def test_no_u(grid: str) -> None:
    board = parse_board(grid)

    assert find_u_candidates(board, len(board) - 1, 0, "R") == []


def test_a_shape_does_not_wrap_around_the_edges() -> None:
    # With negative indexes, the arm above row 0 would wrap to the last row.
    board = parse_board("RRR/.../R.R")

    assert find_u_candidates(board, 0, 0, "R") == []


def test_one_mark_can_complete_two_us_in_a_stable_order() -> None:
    board = parse_board("R.R.R/RRRRR")

    found = find_u_candidates(board, 1, 2, "R")

    assert sorted(found) == [
        ((0, 0), (0, 2), (1, 0), (1, 1), (1, 2)),
        ((0, 2), (0, 4), (1, 2), (1, 3), (1, 4)),
    ]
    assert find_u_candidates(board, 1, 2, "R") == found


def test_a_block_gives_two_candidates_without_duplicates() -> None:
    board = parse_board("RRR/RRR")

    found = find_u_candidates(board, 0, 0, "R")

    assert len(found) == len(set(found)) == 2
