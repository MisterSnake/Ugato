class FixedOrder:
    """A random source whose shuffle always gives the same order."""

    def __init__(self, *names: str) -> None:
        self._names = names

    def shuffle(self, items: list) -> None:
        items.sort(key=self._names.index)
