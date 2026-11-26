from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.games.match import Match


class Color(StrEnum):
    RED = "red"
    BLUE = "blue"
    YELLOW = "yellow"
    GREEN = "green"
    ORANGE = "orange"
    PURPLE = "purple"


class GameStatus(StrEnum):
    WAITING = "waiting"
    PLAYING = "playing"


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
    # Includes the ones who left after the start: the match knows who they are.
    players: list[Player]
    # Created when the game starts.
    match: Match | None = None

    @property
    def status(self) -> GameStatus:
        return GameStatus.WAITING if self.match is None else GameStatus.PLAYING
