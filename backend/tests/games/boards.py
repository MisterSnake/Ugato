from app.games.board import Board, Cell


def parse_board(grid: str) -> Board:
    """Build a board from rows separated by "/".

    "." and "?" are empty cells ("?" only points at the cell a test marks).
    An uppercase letter is a cell of the player with that name, and a lowercase
    letter is a disabled cell of that same player.
    """
    return [
        [
            None if char in ".?" else Cell(char.upper(), disabled=char.islower())
            for char in row
        ]
        for row in grid.split("/")
    ]
