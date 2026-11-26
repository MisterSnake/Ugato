import type { GameState } from './types'

export interface TurnStatus {
  text: string
  isMyTurn: boolean
}

export function turnStatus(state: GameState, me: string): TurnStatus {
  const { currentPlayer, phase } = state
  const isMyTurn = currentPlayer === me
  if (phase === 'choose') {
    const mine = state.chooseMsLeft === null ? 'Choose your U' : 'Choose a U'
    const text = isMyTurn ? mine : `${currentPlayer} is choosing a U`
    return { text, isMyTurn }
  }
  return { text: isMyTurn ? 'Your turn!' : `${currentPlayer}'s turn`, isMyTurn }
}
