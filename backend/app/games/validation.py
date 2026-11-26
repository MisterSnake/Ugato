from collections.abc import Mapping
from typing import Any

from app.games.models import Color, Game, Player

NAME_MIN_LENGTH = 3
NAME_MAX_LENGTH = 20
MIN_PLAYERS = 2
MAX_PLAYERS = 4
DEFAULT_MAX_PLAYERS = 2
BOARD_MIN_SIZE = 8
BOARD_MAX_SIZE = 30


class ValidationError(Exception):
    def __init__(self, field: str, code: str) -> None:
        super().__init__(f"{field}: {code}")
        self.field = field
        self.code = code


def normalize_name(value: object, field: str, code: str) -> str:
    if isinstance(value, str):
        name = value.strip()
        if NAME_MIN_LENGTH <= len(name) <= NAME_MAX_LENGTH and name.isprintable():
            return name
    raise ValidationError(field, code)


def parse_color(value: object) -> Color:
    if isinstance(value, str) and value in Color:
        return Color(value)
    raise ValidationError("color", "invalid_color")


def is_int_between(value: object, minimum: int, maximum: int) -> bool:
    # An exact type check keeps booleans (an int subclass) out.
    return type(value) is int and minimum <= value <= maximum


def parse_max_players(value: object) -> int:
    if is_int_between(value, MIN_PLAYERS, MAX_PLAYERS):
        return value
    raise ValidationError("maxPlayers", "invalid_max_players")


def parse_board(width: object, height: object) -> tuple[int, int]:
    if (
        is_int_between(width, BOARD_MIN_SIZE, BOARD_MAX_SIZE)
        and is_int_between(height, BOARD_MIN_SIZE, BOARD_MAX_SIZE)
        and width >= height
    ):
        return width, height
    raise ValidationError("board", "invalid_board")


def validate_create_request(payload: Mapping[str, Any]) -> Game:
    username = normalize_name(payload.get("username"), "username", "invalid_username")
    color = parse_color(payload.get("color"))
    game_name = normalize_name(
        payload.get("gameName"), "gameName", "invalid_game_name"
    )
    max_players = parse_max_players(
        payload.get("maxPlayers", DEFAULT_MAX_PLAYERS)
    )
    board_width, board_height = parse_board(
        payload.get("boardWidth"), payload.get("boardHeight")
    )
    return Game(
        name=game_name,
        max_players=max_players,
        board_width=board_width,
        board_height=board_height,
        players=[Player(name=username, color=color)],
    )


def validate_join_request(payload: Mapping[str, Any]) -> tuple[str, Player]:
    """The requested game name and the player who wants to join it.

    A bad game name is not rejected here: it becomes "", which matches no game.
    """
    username = normalize_name(payload.get("username"), "username", "invalid_username")
    color = parse_color(payload.get("color"))
    game_name = payload.get("gameName")
    if not isinstance(game_name, str):
        game_name = ""
    return game_name, Player(name=username, color=color)


def check_can_join(game: Game, player: Player) -> None:
    if len(game.players) >= game.max_players:
        raise ValidationError("gameName", "game_full")
    # Both names are already trimmed by the name rules.
    name = player.name.casefold()
    if any(other.name.casefold() == name for other in game.players):
        raise ValidationError("username", "username_taken")
    if any(other.color == player.color for other in game.players):
        raise ValidationError("color", "color_taken")
