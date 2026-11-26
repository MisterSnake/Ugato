from app.games.models import Color, Game, Player
from app.games.rooms import GameRooms, get_game_rooms


def make_game(name: str = "Partida 1") -> Game:
    return Game(
        name=name,
        max_players=4,
        board_width=12,
        board_height=10,
        players=[Player(name="Esteban", color=Color.RED)],
    )


class StandInSession:
    pass


ANA = Player(name="Ana", color=Color.BLUE)
LUIS = Player(name="Luis", color=Color.GREEN)


def test_opening_a_room_records_its_host() -> None:
    rooms, game, host = GameRooms(), make_game(), StandInSession()

    rooms.open(game, host)

    assert rooms.members(game) == [host]


def test_added_players_are_listed_in_join_order() -> None:
    rooms, game = GameRooms(), make_game()
    host, ana, luis = StandInSession(), StandInSession(), StandInSession()
    rooms.open(game, host)

    rooms.add(game, ana, ANA)
    rooms.add(game, luis, LUIS)

    assert [player.name for player in game.players] == ["Esteban", "Ana", "Luis"]
    assert rooms.members(game) == [host, ana, luis]


def test_removing_a_player_drops_them() -> None:
    rooms, game = GameRooms(), make_game()
    host, ana, luis = StandInSession(), StandInSession(), StandInSession()
    rooms.open(game, host)
    rooms.add(game, ana, ANA)
    rooms.add(game, luis, LUIS)

    rooms.remove(game, ana)

    assert [player.name for player in game.players] == ["Esteban", "Luis"]
    assert rooms.members(game) == [host, luis]


def test_get_game_rooms_returns_one_shared_store() -> None:
    assert get_game_rooms() is get_game_rooms()


def test_closing_a_room_returns_the_joined_sessions_and_forgets_it() -> None:
    rooms, game = GameRooms(), make_game()
    host, ana = StandInSession(), StandInSession()
    rooms.open(game, host)
    rooms.add(game, ana, ANA)

    assert rooms.close(game) == [ana]
    assert rooms.members(game) == []


def test_closing_a_stale_game_keeps_the_room_of_the_reused_name() -> None:
    rooms, stale, current = GameRooms(), make_game(), make_game()
    rooms.open(stale, StandInSession())
    rooms.close(stale)
    host = StandInSession()
    rooms.open(current, host)

    assert rooms.close(stale) == []
    assert rooms.members(current) == [host]
    assert rooms.members(stale) == []
