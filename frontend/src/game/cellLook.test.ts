import { describe, expect, it } from 'vitest'
import { cellLook } from './cellLook'
import type { Cell } from './types'

const here = { row: 1, col: 2 }

describe('cellLook', () => {
  it.each<[string, Cell]>([
    ['empty', null],
    ['taken', { owner: 'Ana', disabled: false }],
    ['disabled', { owner: 'Ana', disabled: true }],
    ['left', { owner: 'Luis', disabled: false }],
    ['left-disabled', { owner: 'Luis', disabled: true }],
  ])('gives the %s look', (look, cell) => {
    expect(cellLook(cell, ['Luis'], null, here)).toEqual({
      look,
      isLastMove: false,
    })
  })

  it.each([
    [{ row: 1, col: 2 }, true],
    [{ row: 2, col: 1 }, false],
    [{ row: 1, col: 3 }, false],
  ])('knows whether the last move %o was here', (lastMove, isLastMove) => {
    const cell = { owner: 'Ana', disabled: false }

    expect(cellLook(cell, [], lastMove, here).isLastMove).toBe(isLastMove)
  })
})
