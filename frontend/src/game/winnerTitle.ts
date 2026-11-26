import type { GameOver } from './types'

// A full board needs no explanation: everyone can see it.
const DETAILS: Record<GameOver['reason'], string | undefined> = {
  board_full: undefined,
  last_player: 'Everyone else left.',
  vote: 'The players voted to end the game.',
}

export function winnerTitle(
  { winners, reason }: Pick<GameOver, 'winners' | 'reason'>,
  me: string,
): { title: string; detail?: string } {
  const title = titleFor(winners, me)
  const detail = DETAILS[reason]
  return detail ? { title, detail } : { title }
}

function titleFor(winners: string[], me: string): string {
  if (winners.length > 1) {
    const last = winners[winners.length - 1]
    return `Draw between ${winners.slice(0, -1).join(', ')} and ${last}`
  }
  return winners[0] === me ? 'You win!' : `${winners[0]} wins!`
}
