import type { GameSummary } from '../game/types'
import { colorLabel } from './colorLabel'

interface WaitingScreenProps {
  game: GameSummary
  onCancel: () => void
}

export function WaitingScreen({ game, onCancel }: WaitingScreenProps) {
  const [creator] = game.players

  return (
    <main className="screen">
      <h1>Waiting for players...</h1>
      <dl>
        <dt>Game</dt>
        <dd>{game.name}</dd>
        <dt>Creator</dt>
        <dd>{`${creator.name} (${colorLabel(creator.color)})`}</dd>
        <dt>Players</dt>
        <dd>{`${game.players.length} / ${game.maxPlayers}`}</dd>
        <dt>Board</dt>
        <dd>{`${game.boardWidth} x ${game.boardHeight}`}</dd>
      </dl>
      <button type="button" onClick={onCancel}>
        Cancel game
      </button>
    </main>
  )
}
