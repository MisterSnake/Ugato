import builtins

from app.games.models import Game


class GameRegistry:
    """In-memory games, unique by name ignoring case.

    The state lives in this process, so the server must run a single worker.
    """

    def __init__(self) -> None:
        self._games: dict[str, Game] = {}

    def add(self, game: Game) -> None:
        self._games[self._key(game.name)] = game

    def remove(self, game: Game) -> None:
        key = self._key(game.name)
        # Only the stored game may free the name, not an older one that reused it.
        if self._games.get(key) is game:
            del self._games[key]

    def list(self) -> builtins.list[Game]:
        return builtins.list(self._games.values())

    def exists_by_name(self, name: str) -> bool:
        return self._key(name) in self._games

    @staticmethod
    def _key(name: str) -> str:
        return name.strip().casefold()


_registry = GameRegistry()


def get_registry() -> GameRegistry:
    return _registry
