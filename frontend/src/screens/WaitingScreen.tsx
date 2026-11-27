import type { GameSummary, Role } from '../game/types'
import { TIMER_LABELS } from '../game/validation'
import { colorLabel } from './colorLabel'
import { ClockIcon, GamepadIcon, GridIcon, UsersIcon } from './icons'
import { USpinner } from './USpinner'

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
      <USpinner />
      <dl className="card summary">
        <div className="summary-row">
          <GamepadIcon />
          <dt>Game</dt>
          <dd className="summary-name">{game.name}</dd>
        </div>
        <div className="summary-row">
          <UsersIcon />
          <dt>Players</dt>
          <dd>{`${game.players.length} / ${game.maxPlayers}`}</dd>
          <dd className="summary-wide">
            <ul aria-label="Players" className="players">
              {game.players.map((player, index) => (
                // Names are unique within a game, so they work as keys.
                <li key={player.name}>
                  {/* The host is always the first player. */}
                  <span>
                    {index === 0 ? `${player.name} (host)` : player.name}
                  </span>{' '}
                  <span>{colorLabel(player.color)}</span>
                  <span
                    aria-hidden="true"
                    className={`swatch color-${player.color}`}
                  />
                </li>
              ))}
            </ul>
          </dd>
        </div>
        <div className="summary-row">
          <GridIcon />
          <dt>Board</dt>
          <dd>{`${game.boardWidth} x ${game.boardHeight}`}</dd>
        </div>
        <div className="summary-row">
          <ClockIcon />
          <dt>Timer</dt>
          <dd>{TIMER_LABELS[game.timer]}</dd>
        </div>
      </dl>
      <button
        type="button"
        className="btn-danger btn-large"
        onClick={onLeave}
      >
        {LEAVE_LABELS[role]}
      </button>
    </main>
  )
}
