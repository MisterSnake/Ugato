import { turnStatus } from './turnStatus'
import type { GameState, Vote } from './types'

export function canProposeEnd(state: GameState, me: string): boolean {
  return (
    turnStatus(state, me).isMyTurn &&
    state.phase === 'mark' &&
    !state.vote &&
    state.endProposalsLeft[me] > 0
  )
}

export function voteTitle({ proposer }: Vote, me: string): string {
  return proposer === me
    ? 'You proposed ending the game'
    : `${proposer} wants to end the game`
}

export function voteProgress({ voted, total }: Vote): string {
  return `${voted} of ${total} voted`
}
