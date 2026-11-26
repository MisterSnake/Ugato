import { formatClock } from '../game/clock'
import type { GameState } from '../game/types'
import { useCountdown } from './useCountdown'

interface TurnTextProps {
  state: GameState
  /** Whose turn it is and what they are doing. */
  text: string
  /** Which candidate is shown, for the player choosing one. */
  position?: string
}

/** The line of the turn bar, with the choose clock while it runs. */
export function TurnText({ state, text, position }: TurnTextProps) {
  const { chooseMsLeft } = state
  const msLeft = useCountdown(state, chooseMsLeft ?? 0, chooseMsLeft !== null)

  return (
    <p aria-live="polite" className="turn-text">
      {text}
      {chooseMsLeft !== null && (
        <>
          {' '}
          {/* Hidden, or every tick of the countdown would be read aloud. */}
          <span aria-hidden="true" className="clock">
            {`(${formatClock(msLeft)})`}
          </span>
        </>
      )}
      {position && ` (${position})`}
    </p>
  )
}
