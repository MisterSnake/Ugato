"""The pure rules of the board."""

from dataclasses import dataclass


@dataclass(frozen=True)
class Cell:
    owner: str
    # A disabled cell already scored, so it cannot be part of another U.
    disabled: bool = False


type Board = list[list[Cell | None]]
type Position = tuple[int, int]
type Shape = tuple[Position, ...]

# The U pentomino as (row, col) offsets, once for each side it can open to. The
# order of these shapes and offsets fixes the order of the candidates.
U_SHAPES: tuple[Shape, ...] = (
    ((0, 0), (0, 2), (1, 0), (1, 1), (1, 2)),  # opens up
    ((0, 0), (0, 1), (0, 2), (1, 0), (1, 2)),  # opens down
    ((0, 0), (0, 1), (1, 1), (2, 0), (2, 1)),  # opens left
    ((0, 0), (0, 1), (1, 0), (2, 0), (2, 1)),  # opens right
)


def find_u_candidates(board: Board, row: int, col: int, player: str) -> list[Shape]:
    """Every U of the player that contains the cell at (row, col).

    Each cell of each shape is tried on that cell. These placements all cover
    different cells, so no U is found twice. The notch is never read.
    """
    candidates = []
    for shape in U_SHAPES:
        for anchor_row, anchor_col in shape:
            cells = tuple(
                (row + r - anchor_row, col + c - anchor_col) for r, c in shape
            )
            if all(_can_score(board, r, c, player) for r, c in cells):
                candidates.append(cells)
    return candidates


def _can_score(board: Board, row: int, col: int, player: str) -> bool:
    if not (0 <= row < len(board) and 0 <= col < len(board[row])):
        return False
    return board[row][col] == Cell(player)
