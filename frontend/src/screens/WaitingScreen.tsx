import type { GameSummary, Role } from '../game/types'
import { colorLabel } from './colorLabel'

interface WaitingScreenProps {
  game: GameSummary
  role: Role
  onLeave: () => void
}

const LEAVE_LABELS: Record<Role, string> = {
  host: 'Cancel game',
  player: 'Leave game',
}

export function WaitingScreen({ game, role, onLeave }: WaitingScreenProps) {
  return (
    <main className="screen">
      <h1>Waiting for players...</h1>
      <dl>
        <dt>Game</dt>
        <dd>{game.name}</dd>
        <dt>Players</dt>
        <dd>{`${game.players.length} / ${game.maxPlayers}`}</dd>
        <dd>
          <ul aria-label="Players" className="players">
            {game.players.map((player, index) => (
              // Names are unique within a game, so they work as keys.
              <li key={player.name}>
                {/* The host is always the first player. */}
                <span>
                  {index === 0 ? `${player.name} (host)` : player.name}
                </span>{' '}
                <span>{colorLabel(player.color)}</span>
              </li>
            ))}
          </ul>
        </dd>
        <dt>Board</dt>
        <dd>{`${game.boardWidth} x ${game.boardHeight}`}</dd>
      </dl>
      <button type="button" onClick={onLeave}>
        {LEAVE_LABELS[role]}
      </button>
    </main>
  )
}
