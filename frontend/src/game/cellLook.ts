import type { Cell, Position } from './types'

export type CellLook =
  | 'empty'
  | 'taken'
  | 'disabled'
  | 'left'
  | 'left-disabled'

export function cellLook(
  cell: Cell,
  leftPlayers: string[],
  lastMove: Position | null,
  position: Position,
): { look: CellLook; isLastMove: boolean } {
  const isLastMove =
    lastMove?.row === position.row && lastMove.col === position.col
  return { look: lookOf(cell, leftPlayers), isLastMove }
}

function lookOf(cell: Cell, leftPlayers: string[]): CellLook {
  if (!cell) return 'empty'
  if (leftPlayers.includes(cell.owner)) {
    return cell.disabled ? 'left-disabled' : 'left'
  }
  return cell.disabled ? 'disabled' : 'taken'
}
