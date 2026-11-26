import { describe, expect, it } from 'vitest'
import {
  MAX_CELL_SIZE,
  boardPosition,
  displayGrid,
  displayPosition,
  fitView,
  panBy,
  pinch,
  reveal,
  shouldRotate,
  zoomAt,
  zoomBy,
} from './viewport'
import type { Viewport } from './viewport'

// 20 columns by 10 rows, in an area where it fits at 20px per cell.
const grid = { cols: 20, rows: 10 }
const area = { width: 400, height: 300 }
const fitted = fitView(grid, area)

/** The point of the board, in cells, that a point of the area shows. */
function boardPointAt(view: Viewport, point: { x: number; y: number }) {
  return {
    x: (point.x - view.x) / view.scale,
    y: (point.y - view.y) / view.scale,
  }
}

describe('fitView', () => {
  it('fits the whole board and centers it', () => {
    expect(fitted).toEqual({ scale: 20, x: 0, y: 50 })
  })

  it('fits the rotated board by its displayed sides', () => {
    const rotated = displayGrid({ width: 20, height: 10 }, true)

    expect(fitView(rotated, { width: 300, height: 400 })).toEqual({
      scale: 20,
      x: 50,
      y: 0,
    })
  })

  it('uses the unrotated sides when not rotated', () => {
    expect(displayGrid({ width: 20, height: 10 }, false)).toEqual(grid)
  })
})

describe('zoom', () => {
  it('zooms in about the center of the area', () => {
    const view = zoomBy(fitted, 1.5, grid, area)
    const center = { x: 200, y: 150 }

    expect(view.scale).toBe(30)
    expect(boardPointAt(view, center)).toEqual(boardPointAt(fitted, center))
  })

  it('never zooms out past the fit', () => {
    expect(zoomBy(fitted, 0.5, grid, area)).toEqual(fitted)
  })

  it('never zooms in past the largest cell', () => {
    expect(zoomBy(fitted, 100, grid, area).scale).toBe(MAX_CELL_SIZE)
  })

  it('keeps the fit if it is already past the largest cell', () => {
    const small = { cols: 2, rows: 2 }
    const big = fitView(small, area)

    expect(zoomBy(big, 2, small, area)).toEqual(big)
  })

  it('keeps the anchor in place', () => {
    const anchor = { x: 100, y: 120 }

    const view = zoomAt(fitted, 2, anchor, grid, area)

    expect(boardPointAt(view, anchor)).toEqual(boardPointAt(fitted, anchor))
  })

  it('keeps the point under the fingers in place during a pinch', () => {
    const zoomed = zoomBy(fitted, 1.5, grid, area)
    const before = [
      { x: 150, y: 150 },
      { x: 250, y: 150 },
    ] as const
    // The fingers spread to 1.2 times as far and drift by (-10, 5).
    const after = [
      { x: 130, y: 155 },
      { x: 250, y: 155 },
    ] as const

    const view = pinch(zoomed, before, after, grid, area)

    expect(view.scale).toBeCloseTo(36)
    const under = boardPointAt(view, { x: 190, y: 155 })
    const original = boardPointAt(zoomed, { x: 200, y: 150 })
    expect(under.x).toBeCloseTo(original.x)
    expect(under.y).toBeCloseTo(original.y)
  })

  it('ignores the spread of fingers that started on one point', () => {
    const point = { x: 200, y: 150 }

    const view = pinch(fitted, [point, point], [point, point], grid, area)

    expect(view).toEqual(fitted)
  })
})

describe('pan', () => {
  // 40px cells: an 800 x 400 board in a 400 x 300 area.
  const zoomed = zoomBy(fitted, 2, grid, area)

  it('moves the board', () => {
    expect(panBy(zoomed, 30, -20, grid, area)).toEqual({
      scale: 40,
      x: zoomed.x + 30,
      y: zoomed.y - 20,
    })
  })

  it.each([
    [10_000, 10_000, 0, 0],
    [-10_000, -10_000, -400, -100],
  ])('cannot move the board out of view by (%i, %i)', (dx, dy, x, y) => {
    expect(panBy(zoomed, dx, dy, grid, area)).toEqual({ scale: 40, x, y })
  })

  it('keeps a board that fits centered', () => {
    expect(panBy(fitted, 100, 100, grid, area)).toEqual(fitted)
  })

  it('returns to the fit on reset', () => {
    expect(fitView(grid, area)).toEqual(fitted)
  })
})

describe('reveal', () => {
  const zoomed = { scale: 40, x: 0, y: 0 }

  it('leaves the view alone when the cells are visible', () => {
    expect(reveal(zoomed, [{ row: 0, col: 0 }], grid, area)).toEqual(zoomed)
  })

  it('centers cells that are off screen, within the pan limits', () => {
    const cells = [
      { row: 4, col: 10 },
      { row: 5, col: 12 },
    ]

    // Their center is at (460, 200) on the board.
    expect(reveal(zoomed, cells, grid, area)).toEqual({
      scale: 40,
      x: -260,
      y: -50,
    })
  })
})

describe('rotation', () => {
  it.each([
    [{ width: 300, height: 400 }, true],
    [{ width: 400, height: 300 }, false],
    [{ width: 300, height: 300 }, false],
  ])('rotates in %o: %s', (size, rotated) => {
    expect(shouldRotate(size)).toBe(rotated)
  })

  const size = { width: 30, height: 12 }
  const corners = [
    { row: 0, col: 0 },
    { row: 0, col: 29 },
    { row: 11, col: 0 },
    { row: 11, col: 29 },
    { row: 3, col: 7 },
  ]

  it.each([false, true])(
    'maps a place on screen back to its cell (rotated: %s)',
    (rotated) => {
      const { cols, rows } = displayGrid(size, rotated)

      for (const cell of corners) {
        const shown = displayPosition(cell, size, rotated)
        expect(shown.col).toBeGreaterThanOrEqual(0)
        expect(shown.col).toBeLessThan(cols)
        expect(shown.row).toBeGreaterThanOrEqual(0)
        expect(shown.row).toBeLessThan(rows)
        expect(boardPosition(shown, size, rotated)).toEqual(cell)
      }
    },
  )

  it('turns the board a quarter turn clockwise', () => {
    expect(displayPosition({ row: 0, col: 0 }, size, true)).toEqual({
      row: 0,
      col: 11,
    })
  })

  it('draws cells where they are when not rotated', () => {
    expect(displayPosition({ row: 3, col: 7 }, size, false)).toEqual({
      row: 3,
      col: 7,
    })
  })
})
