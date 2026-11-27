import type { GameOver, Player } from '../game/types'
import { winnerTitle } from '../game/winnerTitle'

interface WinnerScreenProps {
  gameOver: GameOver
  /** Every player of the game, also those who left, with their color. */
  players: Player[]
  /** The user's own name. */
  me: string
  onClose: () => void
}

export function WinnerScreen({
  gameOver,
  players,
  me,
  onClose,
}: WinnerScreenProps) {
  const { title, detail } = winnerTitle(gameOver, me)
  const scores = Object.entries(gameOver.scores).sort(([, a], [, b]) => b - a)

  const colorOf = (name: string) =>
    players.find((player) => player.name === name)?.color

  return (
    <main className="screen">
      <h1>{title}</h1>
      {detail && <p>{detail}</p>}
      <ol aria-label="Final scores" className="card players final-scores">
        {scores.map(([name, score]) => (
          <li key={name}>
            <span
              aria-hidden="true"
              className={`swatch color-${colorOf(name)}`}
            />
            {`${name} ${score}`}
          </li>
        ))}
      </ol>
      <button type="button" className="btn btn-large" onClick={onClose}>
        Close
      </button>
    </main>
  )
}
