# Design

## Context

See proposal.md for why we're adding this, and `specs/turn-timer/spec.md` for the rules. This design covers how the clocks fit into the code that exists today.

- `Match` (`backend/app/games/match.py`) holds the pure game rules. It already takes an injected `clock` (default `time.monotonic`) and uses it for the vote deadline.
- `ws.py` runs the asynchronous parts. The vote limit is enforced by `Table.vote_timer`, an `asyncio` task that `_sync_vote_timer` starts or stops after every state change. The task calls `Match.expire_vote(vote_id)`, and a stale id is ignored. A task that has started sending its result is moved into `_expiring` so that a later change cannot cancel it halfway.
- Tests override FastAPI dependencies (`get_registry`, `get_random`, `get_vote_seconds`) so they run fast and give the same result every time.
- The server runs a single worker and keeps all game state in process memory, so clocks need no persistence.
- The client already counts down a server-sent value locally (`voteCountdown.ts`: value + time received + now).

## Goals / Non-Goals

**Goals:**
- Keep every clock rule inside `Match`, written as pure code driven by the injected clock, so the rules can be unit-tested without `asyncio`.
- Reuse the vote-timer pattern exactly: one task per game, kept in sync after each change, using ids so a stale timeout does nothing.
- The server alone decides time; the client only shows a countdown.

**Non-Goals:**
- No clock sync protocol (pings or offset estimation). The client counts from when it receives a message, as it does for votes.
- No pausing the clocks when a player disconnects: a disconnect means the player leaves.
- No changing the timer mode after the game is created.

## Decisions

### 1. Timer modes as one table on each side
The backend gets a constant mapping each mode to `(start_seconds, increment_seconds)`, with `none` mapped to no clock. The validation rule (`timer` in modes, default `none`, otherwise `invalid_timer`) goes in `validation.py`. It is mirrored in `frontend/src/game/validation.ts`, together with the display labels ("Normal 30-10"). The `Game` model stores the mode. `lobby.py` adds `timer` to the summary, so `game_created`, `game_joined`, `game_updated` and `games_list` all get it in one place.

The mode table is exposed through a dependency (`get_timer_modes`), the same way as `get_vote_seconds`. That lets ws-level tests swap in sub-second modes.

*Alternative:* store the start and increment numbers on `Game` directly. Rejected because the protocol and UI work with mode names, and a name is the only thing a client can send that is easy to validate.

### 2. Clock accounting in `Match`: a stored balance plus a "running since" time
`Match` stores `clocks: dict[str, float]` (seconds left) and `running_since: float | None`, the clock time at which the current player's clock last started. The clock is **started** at the beginning of a turn and when a failed vote resumes it. It is **stopped** when a mark is placed, a vote opens, the current player leaves, or a timeout happens. Stopping subtracts the time elapsed and clamps the balance at 0. The remaining time at any moment is `balance - (now - running_since)` while the clock runs, and `balance` otherwise. `match_state` reports that value in milliseconds.

This makes "freeze during a vote" and "pause while choosing" the same operation: stop. Resuming after a failed vote is simply start.

The increment is applied in a single helper that `mark` and `choose` call just before `_end_turn`. It can't go inside `_end_turn` itself, because `leave` also calls that and a player who leaves gains no increment. The timeout path ends the turn without a move: it skips the increment and resets the clock instead.

*Alternative:* store a deadline per player. Rejected because a deadline has to be moved every time the clock freezes, while a balance only changes when the clock stops.

### 3. A single "clock epoch" id instead of separate turn and choose ids
`Match` increments `clock_epoch` every time the running deadline changes: a turn starts, the choose phase starts, a vote opens or closes, a player leaves. `Match.clock_deadline()` returns `(epoch, seconds until the deadline)` for whichever clock is running (main or choose), or `None` when no clock runs (no timer, a vote is open, or the match is over).

`Match.expire_clock(epoch)` does nothing when the epoch is stale. Otherwise:
- in the `mark` phase it ends the turn without a move, resets the clock, and returns a `TimedOut(player)` result;
- in the `choose` phase it chooses candidate 0 through the same code path as `choose`, so scoring, disabled cells and the increment come from the same code.

*Alternative:* separate ids for turns and choose phases. Rejected because the vote freeze would then need a third id. One epoch covers every case that makes a timeout stale.

### 4. `ws.py`: `Table.turn_timer` kept in sync like `vote_timer`
`_sync_turn_timer(game, table)` runs right after `_sync_vote_timer` everywhere game state changes. If `clock_deadline()` returns an epoch different from the one the current task was started for, it cancels that task and starts a new one, which sleeps for `deadline + GRACE_SECONDS` and then calls `expire_clock(epoch)`. The task then publishes: `turn_timed_out` followed by `game_state` for a timeout, and `game_state` alone for an automatic pick. It follows the same `_expiring` hand-off as `_expire_vote`, so a change made while it is sending cannot cancel it halfway.

Game start schedules the first task. Game end (any reason) cancels it together with the vote timer.

### 5. Grace window: the server simply waits longer
`GRACE_SECONDS = 0.5` is added only to the task's sleep. `Match` itself never refuses a move for being late. While the task is still sleeping, the player still holds the turn, so a move received during the grace window is processed as normal. Its elapsed time clamps the balance at 0, then the increment is added. This keeps the rule ("a move within 500 ms counts") in one place and has no effect on the protocol. The grace value is a dependency (`get_grace_seconds`) so tests can set it to 0.

*Alternative:* have `Match` compare the move time against the deadline plus the grace. Rejected because the task's timing already decides this, and checking it in two places could let the two disagree.

### 6. Choose clock duration
`ceil(increment / 2) * (n - 1)` is computed once, when the turn enters `choose`. The half increment is rounded up before multiplying, as decided during exploration. The choose clock is stored as its own deadline on `Match` and has no balance, because time left unused is lost.

### 7. Protocol additions
- `create_game.timer`: optional, one of `none | slow | normal | fast`.
- `timer` is added to the game summary.
- `game_started` and `game_state` get `timer`, `clocks` (`{name: ms}` or null) and `chooseMsLeft` (ms or null). Values are integers, computed when the message is sent. `match_state` already builds each state per viewer at send time, so the values are fresh.
- New message `turn_timed_out { player }`.
- New error code `invalid_timer` (field `timer`).
- `backend/README.md` documents all of the above.

### 8. Client countdown
A pure helper next to `voteCountdown.ts` computes a shown value: `max(0, msLeft - (now - receivedAt))` when the clock runs, `msLeft` otherwise. A second helper formats it: `m:ss` at 10 s or more, `s.t` below. The clock runs when the player is current, the phase is `mark`, no vote is open, and the timer is not `none`. The choose clock always runs while it is set. `GameScreen` shows the clocks in the player list and the choose countdown in the turn bar. It also shows the `turn_timed_out` notice until the next `game_state` that follows a move, the same pattern as the `vote_failed` notice. A short interval timer re-renders the screen only while a clock is counting down.

## Risks / Trade-offs

- [Late `asyncio` wake-ups on a busy event loop delay timeouts by a few ms] → This is acceptable: the delay only favors the player, and the 500 ms grace is much larger.
- [The client's countdown drifts from the server because of message latency] → The client shows a value slightly higher than the server's, never one that runs out early. The grace window covers the gap, and every `game_state` corrects it.
- [A timeout and a move from the same player race each other] → Both run on the single event loop. Whichever runs first changes `clock_epoch`, so the other sees a stale state: the timeout does nothing, or the move gets `not_your_turn`.
- [A timeout task left running after the game ends or the creator disconnects] → The task is cancelled wherever `stop_vote_timer` is called today, and `expire_clock` also returns `None` once `match.result` is set.
- [Tests that depend on real time are slow or unreliable] → `Match` tests use a fake clock. ws tests override `get_timer_modes` and `get_grace_seconds` with tiny values, as the vote tests do with `get_vote_seconds`.
- [A large banked clock combined with a reset to the starting value can seem odd] → This was decided on purpose during exploration. The UI shows the reset in the next `game_state`.

## Migration Plan

There is no persistent data, so there's nothing to migrate. `timer` defaults to `none`, so a client that doesn't send it keeps today's behavior. The backend and frontend ship together from this repo. To roll back, revert the change.
