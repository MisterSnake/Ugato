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


def hold_random_vote(match: Match, rng: Random) -> bool:
    """Propose ending and answer at random. Return whether the vote failed."""
    turn = (match.current_player, match.phase)
    match.propose_end(match.current_player)
    voters = [name for name in match.remaining_players() if name != turn[0]]
    rng.shuffle(voters)
    for voter in voters:
        if match.vote is None or rng.random() < 0.2:
            break
        # Mostly "continue", so the games live long enough to make Us.
        match.vote_end(voter, rng.random() < 0.05)
    if match.vote is not None:
        match.expire_vote(match.vote.id)
    assert match.vote is None
    if match.result is not None:
        return False
    # A failed vote resumes the same turn.
    assert (match.current_player, match.phase) == turn
    return True


def assert_invariants(match: Match) -> None:
    assert unscored_us(match) == [], match.board
    assert all(0 <= left <= 2 for left in match.proposals_left.values())


def test_no_u_is_ever_left_unscored() -> None:
    rng = Random(2026)
    scored = choices = failed_votes = passed_votes = 0
    for _ in range(200):
        # Small boards with few players make many Us.
        players = PLAYERS[: rng.randint(2, 3)]
        match = Match(players, width=8, height=8, rng=rng)
        while match.result is None:
            player = match.current_player
            if match.proposals_left[player] and rng.random() < 0.1:
                failed_votes += hold_random_vote(match, rng)
                assert_invariants(match)
                if match.result is not None:
                    passed_votes += 1
                    break
            match.mark(player, *rng.choice(empty_cells(match)))
            if match.phase is Phase.CHOOSE:
                choices += 1
                match.choose(player, rng.randrange(len(match.candidates)))

            assert_invariants(match)
        scored += sum(match.scores.values())

    # The games did exercise the rules under test.
    assert scored > 100 and choices > 0
    assert failed_votes > 0 and passed_votes > 0
