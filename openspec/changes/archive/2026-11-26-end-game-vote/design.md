# Design

## Context

See proposal.md for the motivation and `specs/game-play/spec.md` for the behavior. The relevant current state:

- `Match` (`backend/app/games/match.py`) holds the play state and its rules as pure methods (`mark`, `choose`, `leave`) that raise `ValidationError` or change the state. It knows nothing about connections or time.
- `ClientSession._play` (`backend/app/games/ws.py`) runs a move and builds every player's `game_state` with no `await` in between, then sends them through the game's shared `outbox` lock so updates arrive in order. `_finish` removes a finished game in one synchronous step.
- Every change today is triggered by a message or a disconnect. Nothing runs on its own schedule.
- Dependencies are injected the FastAPI way (`get_registry`, `get_random`) so tests can replace them.
- Strict TDD: every rule must be reachable from a fast, deterministic test.

## Goals / Non-Goals

**Goals:**
- Keep the vote rules (attempts, majority, early close, expiry, leaving) in `Match` as pure, synchronous code testable without sockets or real time.
- Keep the timer thin: it only decides *when* to call the rules, never *what* they do.
- Keep "one change in, full state out": a client can redraw the vote from the last `game_state`.

**Non-Goals:**
- A general timer framework or turn time limits.
- Exact countdown sync between server and clients; the client's countdown is approximate.

## Decisions

### 1. The vote is a field of `Match`, not a new phase

`Match` gains `vote: Vote | None`, where `Vote` holds an `id`, the `proposer`, a `deadline` and the votes cast (`dict[str, bool]`, the proposer stored as `True`). `phase` keeps its two values. A vote can only open in the `mark` phase, so while it is open the phase is always `mark`, and closing a failed vote leaves the turn exactly as it was.

`mark` and `choose` check `self.vote is not None` right after `_check_turn`, which gives the spec's error order (`not_your_turn` before `vote_pending`).

- *Alternative*: a third `Phase.VOTE`. Rejected: the client would have to remember the phase to return to, and the wire `phase` would change meaning for an existing field.

### 2. Rule methods report a failed vote by returning it

`propose_end(player)`, `vote(player, end)`, `expire_vote(vote_id)` and `leave(player)` settle the vote when its result is fixed:
- **Pass**: `result` is set with reason `vote` and the winners by score.
- **Fail**: the vote is cleared, the attempts change, and the method returns a `FailedVote(proposer, end_votes, continue_votes)`.

They return `FailedVote | None`. The session sends `vote_failed` when it gets one. A passed vote needs nothing new, because `result` is already how the session detects the end.

- *Why*: the session needs a one-off event (`vote_failed`), but the match stays free of any notion of messages. A returned value is explicit and easy to assert in tests.
- *Alternative*: a `last_failed_vote` field that the session reads and clears. Rejected: it is state that exists only to carry a message, and forgetting to clear it would send the notice twice.

### 3. Settling: one function, used after every vote change

With `n` players still in the game, `needed = n // 2 + 1`, `end` the votes to end, and `pending` the remaining players who have not voted:

```
end >= needed            -> pass
end + pending < needed   -> fail     (cannot reach a majority anymore)
otherwise                -> stay open
```

`vote` and `leave` call it after their change. `expire_vote` counts `pending` as 0, which always settles the vote. A voter who leaves is removed from the votes cast and from `n`. A proposer who leaves clears the vote without settling it, before the existing turn-passing code runs. The `last_player` check in `leave` comes first, as today.

The winner calculation in `_finish_full_board` is extracted to a helper that both `board_full` and `vote` use.

### 4. Time is injected into `Match`

`Match` takes a `clock: Callable[[], float]` (default `time.monotonic`). `propose_end` sets `deadline = clock() + vote_seconds`, and `match_state` sends `secondsLeft = max(0, ceil(deadline - clock()))`. Rule tests pass a fake clock and never sleep.

The vote duration is a `Match` argument, fed from a new `get_vote_seconds` dependency (30 by default) through `ClientSession`, like `get_random`.

### 5. One timer task per open vote, owned by the game

The per-game state that sessions already share (today only the `outbox` lock in `PlayingRole`) becomes a small `Table` object: the `outbox` plus `vote_timer: asyncio.Task | None`. Every `PlayingRole` of the game points to the same `Table`.

```
propose_end accepted (no await yet)
  -> table.vote_timer = create_task(expire_after(seconds, vote.id))
  -> deliver game_state

expire_after: await sleep(seconds)
  -> FailedVote = match.expire_vote(vote_id)      # stale id -> no-op, returns None
  -> build deliveries (vote_failed?, game_state / game_over), no await
  -> deliver via table.outbox; broadcast lobby if over

vote settles early, proposer leaves, or game ends
  -> table.vote_timer.cancel()
```

- **Stale timers**: `expire_vote` ignores an id that is not the open vote's. Cancelling is still done, so tests don't leave tasks behind, but correctness doesn't depend on it. This covers a timer that wakes in the same loop tick as the last vote.
- **Which session runs it**: the task calls the same delivery helpers as `_play`, which only use the shared registry, rooms and hub. It never touches the proposer's own socket, so it keeps working whoever disconnects. A proposer who leaves cancels the vote and the timer anyway.
- *Alternative*: one global scheduler checking deadlines every second. Rejected: it adds a background loop to the app's lifecycle and up to 1 s of lag, for one timer per game at most.

### 6. Per-viewer vote state

`match_state(match, viewer)` already builds a state per recipient. It adds `endProposalsLeft` (every player) and `vote` (`proposer`, `voted`, `total`, `secondsLeft`, `yourVote`). `yourVote` is `"end"`, `"continue"` or `null` and depends on the viewer. No field carries anyone else's vote.

### 7. Client: countdown and notice from the state

- **Countdown**: when a `game_state` with a vote arrives, the client records `secondsLeft` and the arrival time. A 1-second interval redraws `secondsLeft - elapsed`, floored at 0. The math is a pure helper (`voteCountdown.ts`) tested with fake times. Every new `game_state` resets the base, so drift never accumulates past one vote change.
- **Vote panel and propose button**: the button's enabled state is a pure function of the state and the user's name, next to `turnStatus.ts`. The board's `canMark` also checks `state.vote === null`.
- **Failed vote notice**: `App.tsx` keeps the last `vote_failed`. It clears it when a later `game_state` has a different `lastMove`, a different current player, or an open vote. In practice that means the next move or proposal.
- **Winner screen**: `winnerTitle.ts` gets a subtitle for `vote`, like the one for `last_player`.

## Risks / Trade-offs

- [Real sleeps make WebSocket tests slow or flaky] -> Rule tests use the fake clock. WebSocket tests override `get_vote_seconds` with a tiny value (for example 0.05 s) and use `receive_json`, which blocks until the message arrives, instead of fixed sleeps.
- [The timer fires while a vote or leave is being handled] -> Every change runs without `await` between the rule call and building the deliveries. The vote id makes a late expiry a no-op.
- [Players take turns proposing to stall the game] -> Each proposal costs up to 30 s, and the attempts limit stops one player from repeating it alone. Two players alternating could still delay the game. This is accepted for now.
- [The client countdown differs slightly from the server] -> The server decides. The client shows an approximate value that resets on every `game_state`. Hitting 0 on the client sends nothing.
- [The timer outlives the game] -> `_finish` cancels the table's timer, and the stale-id check covers the rest.

## Migration Plan

None. State lives only in process memory, and old clients ignore the new fields. Clients and server must still be deployed together, because an old client cannot vote and would show a vote's `game_state` without a panel.
