import type { GameOver } from '../game/types'
import { winnerTitle } from '../game/winnerTitle'

interface WinnerScreenProps {
  gameOver: GameOver
  /** The user's own name. */
  me: string
  onClose: () => void
}

export function WinnerScreen({ gameOver, me, onClose }: WinnerScreenProps) {
  const { title, detail } = winnerTitle(gameOver, me)
  const scores = Object.entries(gameOver.scores).sort(([, a], [, b]) => b - a)

  return (
    <main className="screen">
      <h1>{title}</h1>
      {detail && <p>{detail}</p>}
      <ol aria-label="Final scores" className="players">
        {scores.map(([name, score]) => (
          <li key={name}>{`${name} ${score}`}</li>
        ))}
      </ol>
      <button type="button" onClick={onClose}>
        Close
      </button>
    </main>
  )
}
