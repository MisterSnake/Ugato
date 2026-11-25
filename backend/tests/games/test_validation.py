from typing import Any

import pytest

from app.games.models import Color, Game, Player
from app.games.validation import ValidationError, validate_create_request


def make_payload(**overrides: Any) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "username": "Esteban",
        "color": "red",
        "gameName": "Partida 1",
        "maxPlayers": 2,
        "boardWidth": 12,
        "boardHeight": 10,
    }
    payload.update(overrides)
    return payload


def assert_rejected(payload: dict[str, Any], field: str, code: str) -> None:
    with pytest.raises(ValidationError) as excinfo:
        validate_create_request(payload)
    assert (excinfo.value.field, excinfo.value.code) == (field, code)


def test_username_is_trimmed() -> None:
    game = validate_create_request(make_payload(username="  Esteban  "))
    assert game.players[0].name == "Esteban"


@pytest.mark.parametrize("username", ["Ana", "a" * 20, "Ñandú"])
def test_valid_username_is_accepted(username: str) -> None:
    game = validate_create_request(make_payload(username=username))
    assert game.players[0].name == username


@pytest.mark.parametrize(
    "username", ["Al", "   ", "a" * 21, "Est\neban", None, 12345]
)
def test_invalid_username_is_rejected(username: object) -> None:
    assert_rejected(make_payload(username=username), "username", "invalid_username")


@pytest.mark.parametrize(
    "color", ["red", "blue", "yellow", "green", "orange", "purple"]
)
def test_allowed_color_is_accepted(color: str) -> None:
    game = validate_create_request(make_payload(color=color))
    assert game.players[0].color == color


@pytest.mark.parametrize("color", ["pink", "", None, ["red"]])
def test_unknown_color_is_rejected(color: object) -> None:
    assert_rejected(make_payload(color=color), "color", "invalid_color")


def test_game_name_is_trimmed() -> None:
    game = validate_create_request(make_payload(gameName=" Partida 1 "))
    assert game.name == "Partida 1"


@pytest.mark.parametrize("game_name", ["abc", "a" * 20])
def test_game_name_at_length_limits_is_accepted(game_name: str) -> None:
    game = validate_create_request(make_payload(gameName=game_name))
    assert game.name == game_name


@pytest.mark.parametrize("game_name", ["ab", "a" * 21, "Part\tida", None])
def test_invalid_game_name_is_rejected(game_name: object) -> None:
    assert_rejected(
        make_payload(gameName=game_name), "gameName", "invalid_game_name"
    )


def test_max_players_defaults_to_two_when_omitted() -> None:
    payload = make_payload()
    del payload["maxPlayers"]
    assert validate_create_request(payload).max_players == 2


@pytest.mark.parametrize("max_players", [2, 3, 4])
def test_allowed_max_players_is_accepted(max_players: int) -> None:
    game = validate_create_request(make_payload(maxPlayers=max_players))
    assert game.max_players == max_players


@pytest.mark.parametrize("max_players", [1, 5, "2", 2.0, True, None])
def test_invalid_max_players_is_rejected(max_players: object) -> None:
    assert_rejected(
        make_payload(maxPlayers=max_players), "maxPlayers", "invalid_max_players"
    )


@pytest.mark.parametrize(("width", "height"), [(8, 8), (30, 8), (30, 30)])
def test_valid_board_is_accepted(width: int, height: int) -> None:
    game = validate_create_request(
        make_payload(boardWidth=width, boardHeight=height)
    )
    assert (game.board_width, game.board_height) == (width, height)


@pytest.mark.parametrize(
    ("width", "height"),
    [
        (8, 30),
        (8, 9),
        (7, 7),
        (31, 10),
        (31, 31),
        (10, 7),
        ("12", 10),
        (12, 10.0),
        (None, 10),
        (12, None),
    ],
)
def test_invalid_board_is_rejected(width: object, height: object) -> None:
    assert_rejected(
        make_payload(boardWidth=width, boardHeight=height),
        "board",
        "invalid_board",
    )


def test_valid_request_returns_game_with_creator_as_only_player() -> None:
    assert validate_create_request(make_payload()) == Game(
        name="Partida 1",
        max_players=2,
        board_width=12,
        board_height=10,
        players=[Player(name="Esteban", color=Color.RED)],
    )


@pytest.mark.parametrize(
    ("invalid_fields", "field", "code"),
    [
        ({"username": "Al", "color": "pink"}, "username", "invalid_username"),
        ({"color": "pink", "gameName": "ab"}, "color", "invalid_color"),
        ({"gameName": "ab", "maxPlayers": 5}, "gameName", "invalid_game_name"),
        ({"maxPlayers": 5, "boardWidth": 31}, "maxPlayers", "invalid_max_players"),
    ],
)
def test_first_failing_field_in_form_order_is_reported(
    invalid_fields: dict[str, Any], field: str, code: str
) -> None:
    assert_rejected(make_payload(**invalid_fields), field, code)
