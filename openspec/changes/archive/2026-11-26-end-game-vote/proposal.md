# Proposal

## Why

Today a started game only ends when the board is full or when everyone else leaves. Players who agree that a game has gone on long enough have no way to stop it together: the only option is to leave, which hands the win to whoever stays. This change lets the players vote to end a game early, with the winner decided by score.

## What Changes

- **Proposing**: on their own turn, in the `mark` phase, a player can propose ending the game with `propose_end`. This opens a vote and pauses the turn.
- **Attempts**: each player can propose at most 2 times. When a vote fails, its proposer spends 1 attempt and every other player still in the game gets 1 attempt back, up to 2. Each player's remaining attempts are part of the game state.
- **Voting**: every other player still in the game votes once with `vote_end {end: true|false}`. A vote cannot be changed. The proposer counts as an automatic "end" vote.
- **Result**: the game ends when the "end" votes are a strict majority of the players still in the game (`floor(n / 2) + 1`). A tie or a majority for "continue" keeps the game going, and the proposer goes on with the same turn.
- **Time limit**: a vote lasts at most 30 seconds. When time runs out, players who have not voted count as "continue". The vote closes early as soon as its result can no longer change.
- **During a vote**: `mark_cell` and `choose_u` are rejected with `vote_pending`. Everyone sees who proposed, how many players have voted out of how many, and the seconds left, but not who voted what.
- **Leaving during a vote**: a voter who leaves is removed from the count, and the majority is recalculated over the remaining players, which can settle the vote. If the proposer leaves, the vote is cancelled with no attempt changes, and the turn passes as today. If only one player is left, the existing `last_player` rule ends the game.
- **End by vote**: `game_over` gets a new reason, `vote`. The winners are the remaining players with the highest score, so a tie is a draw, and players who left do not win. The winner screen says the players voted to end the game.
- **Game screen**: a "Propose ending (n left)" button in the turn bar, enabled only on the user's own turn in the `mark` phase with attempts left. A voting panel shows the vote's progress and countdown, plus "End game" and "Keep playing" buttons for the players who must vote.
- **Failed vote notice**: when a vote fails, everyone gets `vote_failed` with the number of votes on each side and sees "The game goes on" until the next move.
- New messages: `propose_end`, `vote_end` (client to server); `vote_failed` (server to client). `game_state` gains `vote` and `endProposalsLeft`.
- New error codes: `no_proposals_left`, `vote_pending`, `no_vote_pending`, `already_voted`, `proposer_cannot_vote`, `invalid_vote`.

**Out of scope**: turn time limits outside a vote, configuring the number of attempts or the vote duration per game, and showing who voted what.

## Capabilities

### New Capabilities
<!-- None: voting to end the game is part of playing a started game. -->

### Modified Capabilities
- `game-play`: adds proposing an end vote, the attempts rule, voting, the time limit, and how the vote is settled. Changes the game state messages (`vote`, `endProposalsLeft`), the move and choice errors (`vote_pending`), leaving during a vote, the end of the game (new reason `vote`, winners by score), and the game and winner screens.

## Impact

- **Backend**:
  - `Match` (`app/games/match.py`) gains the open vote (with an id), the attempts per player, and methods to propose, vote, expire and settle a vote. `EndReason` gains `vote`. `match_state` sends the vote and the attempts.
  - `ClientSession` (`app/games/ws.py`) handles `propose_end` and `vote_end`, and runs one 30-second timer per open vote. The timer belongs to the game, not to a connection, and is cancelled when the vote closes early or the game ends. Its duration comes from an injectable dependency so tests don't wait.
  - The `backend/README.md` protocol tables are updated.
- **Frontend**:
  - `types.ts` and `gameSocket.ts` gain the new messages, state fields, reason and error codes.
  - `GameScreen` gains the propose button and the voting panel with a countdown. `WinnerScreen` and `winnerTitle.ts` handle the `vote` reason.
- **Dependencies**: none.
