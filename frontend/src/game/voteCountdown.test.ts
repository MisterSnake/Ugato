import { describe, expect, it } from 'vitest'
import { voteCountdown } from './voteCountdown'

describe('voteCountdown', () => {
  // The state arrived 5000 ms into the page's life, with 30 seconds left.
  it.each([
    [0, 30],
    [1_500, 29],
    [10_000, 20],
    [30_000, 0],
    [45_000, 0],
  ])('after %i ms shows %i seconds', (elapsed, shown) => {
    expect(voteCountdown(30, 5_000, 5_000 + elapsed)).toBe(shown)
  })
})
