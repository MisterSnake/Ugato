from typing import Any

import pytest

from app.games.models import Color, Game, Player
from app.games.validation import (
    ValidationError,
    validate_create_request,
    validate_join_request,
    check_can_join,
)


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


def make_join_payload(**overrides: Any) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "gameName": "Partida 1",
        "username": "Ana",
        "color": "blue",
    }
    payload.update(overrides)
    return payload


def test_join_request_returns_the_game_name_and_the_player() -> None:
    assert validate_join_request(make_join_payload(username="  Ana  ")) == (
        "Partida 1",
        Player(name="Ana", color=Color.BLUE),
    )


@pytest.mark.parametrize(
    ("overrides", "field", "code"),
    [
        ({"username": "Al"}, "username", "invalid_username"),
        ({"color": "pink"}, "color", "invalid_color"),
        ({"username": "Al", "color": "pink"}, "username", "invalid_username"),
    ],
)
def test_invalid_join_request_reports_the_first_error(
    overrides: dict[str, Any], field: str, code: str
) -> None:
    with pytest.raises(ValidationError) as excinfo:
        validate_join_request(make_join_payload(**overrides))
    assert (excinfo.value.field, excinfo.value.code) == (field, code)


@pytest.mark.parametrize("game_name", [None, 42, ["Partida 1"]])
def test_join_request_leaves_a_bad_game_name_for_the_lookup(
    game_name: object,
) -> None:
    name, _ = validate_join_request(make_join_payload(gameName=game_name))
    assert name == ""


def test_join_request_accepts_a_missing_game_name() -> None:
    payload = make_join_payload()
    del payload["gameName"]
    assert validate_join_request(payload)[0] == ""


def make_joinable_game(max_players: int = 3) -> Game:
    return Game(
        name="Partida 1",
        max_players=max_players,
        board_width=12,
        board_height=10,
        players=[
            Player(name="Esteban", color=Color.RED),
            Player(name="Ana", color=Color.BLUE),
        ],
    )


@pytest.mark.parametrize(
    ("max_players", "name", "color", "field", "code"),
    [
        (2, "Luis", Color.GREEN, "gameName", "game_full"),
        (3, "esteban", Color.GREEN, "username", "username_taken"),
        (3, "Luis", Color.RED, "color", "color_taken"),
        (3, "Esteban", Color.RED, "username", "username_taken"),
        (2, "Esteban", Color.GREEN, "gameName", "game_full"),
    ],
)
def test_player_who_cannot_join_is_rejected(
    max_players: int, name: str, color: Color, field: str, code: str
) -> None:
    with pytest.raises(ValidationError) as excinfo:
        check_can_join(make_joinable_game(max_players), Player(name, color))
    assert (excinfo.value.field, excinfo.value.code) == (field, code)


def test_free_name_and_color_can_join_a_game_with_room() -> None:
    game = make_joinable_game()
    check_can_join(game, Player("Luis", Color.GREEN))
    assert len(game.players) == 2


@pytest.mark.parametrize("timer", ["none", "slow", "normal", "fast"])
def test_allowed_timer_is_accepted(timer: str) -> None:
    assert validate_create_request(make_payload(timer=timer)).timer == timer


def test_timer_defaults_to_none_when_missing() -> None:
    assert validate_create_request(make_payload()).timer == "none"


@pytest.mark.parametrize("timer", ["blitz", "", 1, None, ["fast"]])
def test_unknown_timer_is_rejected(timer: object) -> None:
    assert_rejected(make_payload(timer=timer), "timer", "invalid_timer")
