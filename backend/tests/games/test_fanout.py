import asyncio
from typing import Any

from app.games.fanout import send_to_each


class FakeSocket:
    def __init__(self, fails: bool = False) -> None:
        self.fails = fails
        self.sent: list[Any] = []

    async def send_json(self, message: Any) -> None:
        if self.fails:
            raise RuntimeError("connection is gone")
        self.sent.append(message)


def test_failed_socket_does_not_block_the_others_and_is_returned() -> None:
    first, broken, last = FakeSocket(), FakeSocket(fails=True), FakeSocket()

    failed = asyncio.run(send_to_each([first, broken, last], {"type": "ping"}))

    assert failed == [broken]
    assert first.sent == last.sent == [{"type": "ping"}]
