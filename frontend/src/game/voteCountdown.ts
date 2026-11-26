/**
 * The whole seconds a vote has left at `now`, rounded up like the server's.
 * Both times are in milliseconds, on the same clock.
 */
export function voteCountdown(
  secondsLeft: number,
  receivedAt: number,
  now: number,
): number {
  return Math.max(0, Math.ceil(secondsLeft - (now - receivedAt) / 1000))
}
