from collections.abc import Iterable
from typing import Any

from fastapi import WebSocket


async def send_to_each(
    sockets: Iterable[WebSocket], message: dict[str, Any]
) -> list[WebSocket]:
    """Send a message to every socket. Return the ones where sending failed."""
    failed = []
    # A copy, because connections can come and go while a send is awaited.
    for websocket in list(sockets):
        try:
            await websocket.send_json(message)
        except Exception:
            # Whatever broke this connection must not affect the others.
            failed.append(websocket)
    return failed
