from dataclasses import dataclass
from enum import StrEnum


class Color(StrEnum):
    RED = "red"
    BLUE = "blue"
    YELLOW = "yellow"
    GREEN = "green"
    ORANGE = "orange"
    PURPLE = "purple"


@dataclass
class Player:
    name: str
    color: Color


@dataclass
class Game:
    name: str
    max_players: int
    board_width: int
    board_height: int
    players: list[Player]
