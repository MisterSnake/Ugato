import { useEffect, useState } from 'react'
import type {
  Color,
  GameState,
  Player,
  Position,
  VoteFailed,
} from '../game/types'
import { turnStatus } from '../game/turnStatus'
import { canProposeEnd } from '../game/voteStatus'
import { colorLabel } from './colorLabel'
import { GameBoard } from './GameBoard'
import { VotePanel } from './VotePanel'

interface GameScreenProps {
  state: GameState
  /** Every player of the game, also those who left, with their color. */
  players: Player[]
  /** The user's own name. */
  me: string
  /** A vote that has just failed. */
  failedVote?: VoteFailed
  onMark: (row: number, col: number) => void
  onChoose: (index: number) => void
  onPropose: () => void
  onVote: (end: boolean) => void
  onLeave: () => void
}

export function GameScreen({
  state,
  players,
  me,
  failedVote,
  onMark,
  onChoose,
  onPropose,
  onVote,
  onLeave,
}: GameScreenProps) {
  const status = turnStatus(state, me)
  const colorOf = (name: string): Color | undefined =>
    players.find((player) => player.name === name)?.color
  const currentColor = colorOf(state.currentPlayer)

  const canMark = ({ row, col }: Position) =>
    status.isMyTurn &&
    state.phase === 'mark' &&
    !state.vote &&
    !state.board[row][col]
  const [selection, setSelection] = useState<Position | null>(null)
  // A selection that can no longer be marked is not shown.
  const selected = selection && canMark(selection) ? selection : null

  // The server only sends candidates to the player who has to choose.
  const candidates = state.candidates ?? []
  const choiceKey = JSON.stringify(candidates)
  const [shownChoice, setShownChoice] = useState({ key: '', index: 0 })
  // A new choice starts at its first candidate.
  const index = shownChoice.key === choiceKey ? shownChoice.index : 0
  const candidate = candidates[index] ?? null

  function cycle(step: number) {
    const next = (index + step + candidates.length) % candidates.length
    setShownChoice({ key: choiceKey, index: next })
  }

  function mark({ row, col }: Position) {
    setSelection(null)
    onMark(row, col)
  }

  function handleTap(cell: Position, pointerType: string) {
    if (!canMark(cell)) return
    // A click is precise. A finger is not, so it only selects.
    if (pointerType === 'mouse') mark(cell)
    else {
      const again = selected?.row === cell.row && selected.col === cell.col
      setSelection(again ? null : cell)
    }
  }

  useEffect(() => {
    const previous = document.title
    return () => {
      document.title = previous
    }
  }, [])
  useEffect(() => {
    document.title = status.isMyTurn ? 'Your turn! - Ugato' : 'Ugato'
  }, [status.isMyTurn])

  return (
    <main className="game">
      <header
        data-testid="turn-bar"
        className={`turn-bar color-${currentColor}${status.isMyTurn ? ' mine' : ''}`}
      >
        <p aria-live="polite" className="turn-text">
          {candidate
            ? `${status.text} (${index + 1} of ${candidates.length})`
            : status.text}
        </p>
        <p className="turn-player">
          <span aria-hidden="true" className="swatch" />
          {currentColor &&
            `${state.currentPlayer} (${colorLabel(currentColor)})`}
        </p>
        {selected && (
          <button type="button" onClick={() => mark(selected)}>
            Mark
          </button>
        )}
        {candidate && (
          <div className="actions">
            <button type="button" onClick={() => cycle(-1)}>
              Previous
            </button>
            <button type="button" onClick={() => cycle(1)}>
              Next
            </button>
            <button type="button" onClick={() => onChoose(index)}>
              Confirm
            </button>
          </div>
        )}
        <button
          type="button"
          disabled={!canProposeEnd(state, me)}
          onClick={onPropose}
        >
          {`Propose ending (${state.endProposalsLeft[me]} left)`}
        </button>
      </header>

      {state.vote && <VotePanel vote={state.vote} me={me} onVote={onVote} />}
      {failedVote && (
        <p role="status" className="vote-notice">
          {`The game goes on (${failedVote.endVotes} to end, ${failedVote.continueVotes} to keep playing)`}
        </p>
      )}

      <GameBoard
        state={state}
        players={players}
        turnColor={status.isMyTurn ? (currentColor ?? null) : null}
        selected={selected}
        candidate={candidate}
        onTap={handleTap}
      />

      <ol aria-label="Players" className="scores">
        {state.turnOrder.map((name) => (
          <li key={name}>
            <span
              aria-hidden="true"
              className={`swatch color-${colorOf(name)}`}
            />
            {`${name} ${state.scores[name]}`}
            {state.leftPlayers.includes(name) && ' (left)'}
          </li>
        ))}
      </ol>
      <button type="button" className="leave" onClick={onLeave}>
        Leave game
      </button>
    </main>
  )
}
