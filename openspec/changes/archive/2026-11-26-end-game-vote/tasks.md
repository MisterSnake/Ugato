# Tasks

Every feature task is a Red-Green-Refactor cycle:
1. **Red**: write the failing test and run the suite to see it fail.
2. **Green**: write the minimal English-named code that makes it pass.
3. **Refactor**: clean up with the suite still green.

Backend tests run with `./.venv/Scripts/python.exe -m pytest -q` (from `backend/`). Frontend tests run with `npm test` (from `frontend/`).

Rule tests build a `Match` with a fake clock (a callable returning a number the test controls) and a vote duration of 30, so they never sleep.

## 1. Backend: vote rules in `Match`

- [x] 1.1 Attempts and the injected clock.
  - Red: `tests/games/test_match.py` checks that a new match gives every player 2 attempts, and that `Match` accepts a `clock` and a `vote_seconds` (existing tests keep working with the defaults).
  - Green: `endProposalsLeft`-backing attempts dict, and the `clock` / `vote_seconds` arguments on `Match`.
  - Refactor.
  - Verify: tests green.
- [x] 1.2 Propose ending the game.
  - Red:
    - A valid `propose_end` opens a vote with the proposer counted as "end", a new id and a deadline of `clock() + 30`.
    - These are rejected with the right code and leave the match unchanged, in the spec's order: `not_your_turn`, `vote_pending`, `choice_pending`, `no_proposals_left`. When several fail, only the first is reported.
  - Green: `Vote` dataclass and `Match.propose_end(player)`.
  - Refactor.
  - Verify: tests green.
- [x] 1.3 Moves are blocked during a vote.
  - Red: with a vote open, `mark` and `choose` from the current player raise `vote_pending`, after `not_your_turn` and before `choice_pending` / `no_choice_pending`, and change nothing.
  - Green: the check in `mark` and `choose`.
  - Refactor.
  - Verify: tests green, existing move-error tests still pass.
- [x] 1.4 Voting and settling early.
  - Red:
    - `vote(player, end)` records the vote. Rejected in order: `no_vote_pending`, `proposer_cannot_vote`, `already_voted`, `invalid_vote` (missing, non-boolean, or an integer such as 1).
    - The spec scenarios "Majority ends the game" (3 players, passes before the third votes), "Tie keeps the game going", "Two players must agree" and "Result decided early" (fails before the fourth votes).
    - A vote that stays open returns `None` and keeps the turn and phase.
  - Green: `Match.vote` and one settle function (`end >= n // 2 + 1` passes, `end + pending < needed` fails).
  - Refactor.
  - Verify: tests green.
- [x] 1.5 Failed vote: attempts and the turn.
  - Red:
    - A failed vote returns `FailedVote(proposer, end_votes, continue_votes)`, clears the vote, and keeps the proposer's turn in the `mark` phase.
    - The spec scenarios of "End-vote attempts": the proposer loses 1, the others gain 1 up to 2, recovery from 0.
    - The proposer can propose again on the same turn if they still have attempts.
  - Green: the fail branch of settling.
  - Refactor.
  - Verify: tests green.
- [x] 1.6 Passed vote: winners by score.
  - Red: a passed vote sets `result` with reason `vote`. The winners are the remaining players with the highest score; a tie gives several winners; a player who left with the highest score does not win. Attempts are unchanged.
  - Green: `EndReason.VOTE`, and the winner calculation extracted from `_finish_full_board` into a helper shared by both reasons.
  - Refactor.
  - Verify: tests green, the `board_full` tests still pass.
- [x] 1.7 Expiry.
  - Red:
    - `expire_vote(vote_id)` with the open vote's id counts missing votes as "continue" and settles: the spec scenario "Silent players keep the game going" returns a `FailedVote` with 1 to end and 2 to keep playing.
    - An id that is not the open vote's (an old vote, or no vote open) changes nothing and returns `None`.
  - Green: `Match.expire_vote`.
  - Refactor.
  - Verify: tests green.
- [x] 1.8 Leaving during a vote.
  - Red:
    - The spec scenario "Voter leaves and the vote settles": the leaver's vote is dropped, the majority is recomputed over 3, and the vote passes.
    - A voter leaving without settling the vote keeps it open with a smaller total.
    - "Proposer leaves": the vote is cleared, no attempts change, and the turn passes to the next remaining player.
    - "Last player during a vote": reason `last_player`, not `vote`.
    - `leave` returns a `FailedVote` when the leave makes the vote fail.
  - Green: vote handling in `Match.leave`, which now returns `FailedVote | None`.
  - Refactor.
  - Verify: tests green, the existing leave tests still pass.
- [x] 1.9 Vote and attempts in the state.
  - Red:
    - `match_state` has `endProposalsLeft` for every player and `vote: null` with no vote open.
    - With a vote open: `proposer`, `voted` (proposer included), `total` (players still in), `secondsLeft` as whole seconds rounded up from the fake clock and never below 0, and `yourVote` as `"end"`, `"continue"` or `null` for the viewer.
    - The state never contains another player's vote (spec scenario "Votes stay secret").
    - `game_over_payload` reports reason `vote`.
  - Green: serialization in `match.py`.
  - Refactor.
  - Verify: tests green.
- [x] 1.10 The no-unscored-U invariant still holds.
  - Red: extend `test_match_invariant.py` so the random games also propose and vote at random (with failed votes resuming the turn) and check that the invariant and the attempts bounds (0 to 2) hold after every step.
  - Green: nothing new should be needed; fix the rules if the test finds a case.
  - Refactor.
  - Verify: test green.

## 2. Backend: votes over `WS /api/ws`

- [x] 2.1 The shared `Table` and the duration dependency.
  - Red: `tests/games/test_ws.py` checks that a started game still delivers `game_started` and moves in order after `PlayingRole` holds a shared table instead of the bare `outbox` (existing tests), and that overriding a new `get_vote_seconds` dependency reaches the match.
  - Green: `Table` (outbox plus `vote_timer`), `get_vote_seconds` (30), passed through `ClientSession` into `Match`.
  - Refactor.
  - Verify: tests green.
- [x] 2.2 `propose_end` and `vote_end` messages.
  - Red:
    - A valid `propose_end` sends `game_state` with the open vote to every player.
    - A vote that stays open sends `game_state` to every player.
    - Each proposal and vote error reaches only the sender, and nobody gets `game_state`. Both messages from a waiting room or a connection in no game get `game_not_started`.
  - Green: `propose_end` and `vote_end` in `ClientSession.handle`, going through `_play`.
  - Refactor.
  - Verify: tests green.
- [x] 2.3 Settled votes over the socket.
  - Red:
    - A failed vote sends `vote_failed` (proposer and counts) then `game_state` to every player, and the proposer can then send a valid `mark_cell`.
    - A passed vote sends `game_over` with reason `vote` to every player, the game is removed, and lobby subscribers get a `games_list` without it.
    - A voter's disconnect that settles the vote sends the same messages to the remaining players.
  - Green: `_play` and `_quit_match` deliver `vote_failed` when the rule returns a `FailedVote`.
  - Refactor.
  - Verify: tests green.
- [x] 2.4 The vote timer.
  - Red, with `get_vote_seconds` overridden to a tiny value (for example 0.05):
    - A vote nobody answers ends with `vote_failed` then `game_state` to every player, received with a blocking `receive_json`, without fixed sleeps.
    - In a 2-player game where the other player never votes, the turn stays with the proposer after the expiry.
    - A vote that settles early, a proposer who leaves, and a game that ends all cancel the table's timer (asserted on the task), and no extra message follows.
  - Green: `expire_after` task created when `propose_end` is accepted, calling `expire_vote` and the same delivery path as `_play`; cancellation on early settle, cancelled vote and `_finish`.
  - Refactor.
  - Verify: tests green, and the full backend suite shows no "Task was destroyed but it is pending" warnings.
- [x] 2.5 Document the protocol in `backend/README.md`:
  - `propose_end`, `vote_end` and `vote_failed` with their fields.
  - `vote` and `endProposalsLeft` in `game_state` / `game_started`, and reason `vote` in `game_over`.
  - The new error codes with their order for `propose_end`, `vote_end`, `mark_cell` and `choose_u`.
  - The 30-second limit and that missing votes count as "continue".
  - Verify: every message type and error code in `ws.py` appears in the README.

## 3. Frontend: types and socket client

- [x] 3.1 New messages in `gameSocket.ts`.
  - Red: `gameSocket.test.ts` checks that `proposeEnd()` and `voteEnd(end)` send the expected JSON (queued until the socket opens), and that `vote_failed` reaches its handler.
  - Green: `Vote`, `VoteFailed`, `endProposalsLeft`, the `vote` reason and the new error codes in `types.ts`, and the methods and event in `gameSocket.ts`.
  - Refactor.
  - Verify: tests green, and `npx tsc -b` passes.
- [x] 3.2 Error messages for the new codes.
  - Red: `errorMessages.test.ts` maps each new code (`no_proposals_left`, `vote_pending`, `no_vote_pending`, `already_voted`, `proposer_cannot_vote`, `invalid_vote`) to an English message.
  - Green: entries in `errorMessages.ts`.
  - Refactor.
  - Verify: tests green.

## 4. Frontend: pure vote modules

- [x] 4.1 `voteCountdown(secondsLeft, receivedAt, now)`.
  - Red: `src/game/voteCountdown.test.ts` checks the seconds shown right after a state arrives, after 1.5 s and 10 s, and that it never goes below 0.
  - Green: `src/game/voteCountdown.ts`.
  - Refactor.
  - Verify: tests green.
- [x] 4.2 `canProposeEnd(state, me)` and the vote texts.
  - Red: enabled only on the user's turn, in the `mark` phase, with no vote open and at least 1 attempt. The panel title is "You proposed ending the game" for the proposer and "<name> wants to end the game" for the others. The progress text is "<voted> of <total> voted".
  - Green: helpers in a new `src/game/voteStatus.ts`.
  - Refactor.
  - Verify: tests green.
- [x] 4.3 `winnerTitle` for reason `vote`.
  - Red: `winnerTitle.test.ts` checks that reason `vote` keeps the winner title ("Esteban wins!", draws too) and adds the line that the players voted to end the game.
  - Green: the `vote` branch in `winnerTitle.ts`.
  - Refactor.
  - Verify: tests green.

## 5. Frontend: screens

- [x] 5.1 Propose button.
  - Red: `GameScreen.test.tsx` checks that "Propose ending (2 left)" sends `propose_end` on the user's turn, and that it is disabled out of turn, while choosing a U, during a vote and with 0 attempts.
  - Green: the button in the turn bar.
  - Refactor.
  - Verify: tests green.
- [x] 5.2 Voting panel.
  - Red, with fake timers:
    - A player who has not voted sees "Esteban wants to end the game", "1 of 3 voted", the countdown, and "End game" / "Keep playing", which send `vote_end` with `true` / `false`.
    - After voting (`yourVote` set), the buttons are replaced by a note that they voted.
    - The proposer sees "You proposed ending the game" and no vote buttons.
    - The countdown goes down as time passes and restarts from each new state.
    - Clicking an empty cell during a vote sends nothing.
  - Green: the panel in `GameScreen`, and `canMark` checking `state.vote`.
  - Refactor.
  - Verify: tests green.
- [x] 5.3 Failed vote notice.
  - Red: `App.test.tsx`, with `FakeWebSocket`, checks that after `vote_failed` with 1 and 2 the user sees "The game goes on (1 to end, 2 to keep playing)", that it stays through the `game_state` sent with it, and that it disappears after a `game_state` with a new move or an open vote.
  - Green: the last `vote_failed` kept in `App.tsx` and shown on the game screen.
  - Refactor.
  - Verify: tests green.
- [x] 5.4 Winner screen after a vote.
  - Red: `WinnerScreen.test.tsx` checks that `game_over` with reason `vote` shows the winner title, the voted-to-end line and the final scores.
  - Green: use the new `winnerTitle` output in `WinnerScreen`.
  - Refactor.
  - Verify: tests green.

## 6. Integration checks

- [x] 6.1 Full suites and build: the backend suite, `npm test`, `npm run lint` and `npm run build` all pass.
- [x] 6.2 Manual check with the dev servers and three browser windows: a vote that passes shows the winner screen with the vote line; a vote that fails shows the notice and returns the turn to the proposer with the right attempts on every button; a vote nobody answers fails after about 30 seconds.

## Workflow follow-up

- Archive the change after review, and check that `openspec/specs/game-play/spec.md` contains the new requirements.
