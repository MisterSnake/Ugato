import type { Board, Cell, GameState } from '../game/types'

export function emptyBoard(width: number, height: number): Board {
  return Array.from({ length: height }, () =>
    Array.from<Cell>({ length: width }).fill(null),
  )
}

/** A 12 x 10 game that has just started, with "Ana" to move. */
export function makeState(overrides: Partial<GameState> = {}): GameState {
  return {
    board: emptyBoard(12, 10),
    turnOrder: ['Ana', 'Esteban'],
    currentPlayer: 'Ana',
    phase: 'mark',
    scores: { Ana: 0, Esteban: 0 },
    leftPlayers: [],
    lastMove: null,
    ...overrides,
  }
}
