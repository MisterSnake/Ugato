import { describe, expect, it } from 'vitest'
import { makeState } from '../test/gameState'
import { clockCountdown, formatClock, isClockRunning } from './clock'
import type { GameState } from './types'

describe('clockCountdown', () => {
  // The state arrived 5000 ms into the page's life, with 30 seconds left.
  it.each([
    [0, 30_000],
    [1_500, 28_500],
    [30_000, 0],
    [45_000, 0],
  ])('after %i ms shows a running clock at %i ms', (elapsed, shown) => {
    expect(clockCountdown(30_000, 5_000, 5_000 + elapsed, true)).toBe(shown)
  })

  it('keeps the value of a stopped clock', () => {
    expect(clockCountdown(30_000, 5_000, 17_000, false)).toBe(30_000)
  })
})

describe('formatClock', () => {
  it.each([
    [75_000, '1:15'],
    [21_000, '0:21'],
    [10_000, '0:10'],
    [9_400, '9.4'],
    [5_000, '5.0'],
    [0, '0.0'],
    [-20, '0.0'],
  ])('shows %i ms as %s', (ms, shown) => {
    expect(formatClock(ms)).toBe(shown)
  })

  // Rounded up, so a clock only shows zero once nothing is left.
  it.each([
    [20_001, '0:21'],
    [9_999, '0:10'],
    [9_301, '9.4'],
    [1, '0.1'],
  ])('rounds %i ms up to %s', (ms, shown) => {
    expect(formatClock(ms)).toBe(shown)
  })
})

describe('isClockRunning', () => {
  const timed: Partial<GameState> = { timer: 'normal' }
  const vote = {
    proposer: 'Ana',
    voted: 1,
    total: 2,
    secondsLeft: 30,
    yourVote: null,
  }

  it('runs for the current player while they have to mark', () => {
    expect(isClockRunning(makeState(timed), 'Ana')).toBe(true)
  })

  it.each<[string, Partial<GameState>, string]>([
    ['another player', timed, 'Esteban'],
    ['a choice', { ...timed, phase: 'choose' }, 'Ana'],
    ['an open vote', { ...timed, vote }, 'Ana'],
    ['an untimed game', { timer: 'none' }, 'Ana'],
  ])('does not run for %s', (_, state, player) => {
    expect(isClockRunning(makeState(state), player)).toBe(false)
  })
})
