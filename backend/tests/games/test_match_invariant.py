from random import Random

from app.games.board import find_u_candidates
from app.games.match import Match, Phase

PLAYERS = ["R", "B", "G"]


def unscored_us(match: Match) -> list[tuple]:
    """Every U on the board that is complete and still enabled."""
    return [
        u
        for row, cells in enumerate(match.board)
        for col, cell in enumerate(cells)
        if cell is not None
        for u in find_u_candidates(match.board, row, col, cell.owner)
    ]


def empty_cells(match: Match) -> list[tuple[int, int]]:
    return [
        (row, col)
        for row, cells in enumerate(match.board)
        for col, cell in enumerate(cells)
        if cell is None
    ]


def test_no_u_is_ever_left_unscored() -> None:
    rng = Random(2026)
    scored = choices = 0
    for _ in range(200):
        # Small boards with few players make many Us.
        players = PLAYERS[: rng.randint(2, 3)]
        match = Match(players, width=8, height=8, rng=rng)
        while match.result is None:
            player = match.current_player
            match.mark(player, *rng.choice(empty_cells(match)))
            if match.phase is Phase.CHOOSE:
                choices += 1
                match.choose(player, rng.randrange(len(match.candidates)))

            assert unscored_us(match) == [], match.board
        scored += sum(match.scores.values())

    # The games did exercise the rules under test.
    assert scored > 100 and choices > 0
