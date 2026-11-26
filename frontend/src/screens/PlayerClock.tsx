import { formatClock, isClockRunning } from '../game/clock'
import type { GameState } from '../game/types'
import { useCountdown } from './useCountdown'

interface PlayerClockProps {
  state: GameState
  player: string
  /** The player's time in `state`. */
  msLeft: number
}

export function PlayerClock({ state, player, msLeft }: PlayerClockProps) {
  const shown = useCountdown(state, msLeft, isClockRunning(state, player))

  return <span className="clock">{formatClock(shown)}</span>
}
