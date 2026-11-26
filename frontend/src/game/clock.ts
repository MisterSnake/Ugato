import type { GameState } from './types'

const TENTHS_BELOW_MS = 10_000

/**
 * What a clock shows at `now`, in milliseconds. A running one has gone down
 * since its value arrived. The times are in milliseconds, on the same clock.
 */
export function clockCountdown(
  msLeft: number,
  receivedAt: number,
  now: number,
  running: boolean,
): number {
  return running ? Math.max(0, msLeft - (now - receivedAt)) : msLeft
}

/** "m:ss", or "s.t" under 10 seconds. Both are rounded up, as votes are. */
export function formatClock(ms: number): string {
  const tenths = Math.ceil(Math.max(0, ms) / 100)
  if (tenths * 100 < TENTHS_BELOW_MS) return (tenths / 10).toFixed(1)
  const seconds = Math.ceil(ms / 1000)
  const rest = String(seconds % 60).padStart(2, '0')
  return `${Math.floor(seconds / 60)}:${rest}`
}

/** Whether a player's clock is counting down in this state. */
export function isClockRunning(state: GameState, player: string): boolean {
  return (
    state.timer !== 'none' &&
    state.currentPlayer === player &&
    state.phase === 'mark' &&
    !state.vote
  )
}
