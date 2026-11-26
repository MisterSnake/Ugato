import type { GameOver } from './types'

export function winnerTitle(
  { winners, reason }: Pick<GameOver, 'winners' | 'reason'>,
  me: string,
): { title: string; detail?: string } {
  const title = titleFor(winners, me)
  return reason === 'last_player'
    ? { title, detail: 'Everyone else left.' }
    : { title }
}

function titleFor(winners: string[], me: string): string {
  if (winners.length > 1) {
    const last = winners[winners.length - 1]
    return `Draw between ${winners.slice(0, -1).join(', ')} and ${last}`
  }
  return winners[0] === me ? 'You win!' : `${winners[0]} wins!`
}
