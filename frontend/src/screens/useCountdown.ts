import { useEffect, useState } from 'react'
import { clockCountdown } from '../game/clock'
import type { GameState } from '../game/types'

// Often enough for the tenths to be seen changing.
const TICK_MS = 100

/**
 * What a clock of `state` shows now, counting from when that state arrived. The
 * server decides when time is up, so this is only approximate. It only keeps an
 * interval, and so re-renders its component, while the clock runs.
 */
export function useCountdown(
  /** The latest state. Each one that arrives is a new object. */
  state: GameState,
  msLeft: number,
  running: boolean,
): number {
  const [tick, setTick] = useState({ state, msLeft })

  useEffect(() => {
    if (!running) return
    const receivedAt = Date.now()
    const timer = setInterval(() => {
      const shown = clockCountdown(msLeft, receivedAt, Date.now(), true)
      setTick({ state, msLeft: shown })
    }, TICK_MS)
    return () => clearInterval(timer)
  }, [state, msLeft, running])

  // A new state shows its own time until its first tick.
  return running && tick.state === state ? tick.msLeft : msLeft
}
