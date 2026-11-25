from app.games.models import Color, Game, Player
from app.games.registry import GameRegistry


def make_game(name: str = "Partida 1") -> Game:
    return Game(
        name=name,
        max_players=2,
        board_width=12,
        board_height=10,
        players=[Player(name="Esteban", color=Color.RED)],
    )


def test_new_registry_is_empty() -> None:
    registry = GameRegistry()
    assert registry.list() == []
    assert not registry.exists_by_name("Partida 1")


def test_added_game_is_listed_with_all_its_data() -> None:
    registry = GameRegistry()
    registry.add(make_game())
    assert registry.list() == [make_game()]


def test_name_lookup_ignores_case_and_surrounding_whitespace() -> None:
    registry = GameRegistry()
    registry.add(make_game("Partida 1"))
    assert registry.exists_by_name("  partida 1")
    assert not registry.exists_by_name("Partida 2")


def test_removing_a_game_frees_its_name() -> None:
    registry = GameRegistry()
    game = make_game()
    registry.add(game)
    registry.remove(game)
    assert not registry.exists_by_name("Partida 1")
    registry.add(make_game())
    assert registry.list() == [make_game()]


def test_removing_a_missing_game_does_not_raise() -> None:
    registry = GameRegistry()
    registry.remove(make_game())
    assert registry.list() == []


def test_removing_a_stale_game_keeps_the_new_owner_of_the_name() -> None:
    registry = GameRegistry()
    stale = make_game()
    registry.add(stale)
    registry.remove(stale)
    registry.add(make_game())
    registry.remove(stale)
    assert registry.exists_by_name("Partida 1")
