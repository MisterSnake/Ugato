// The math of zooming, panning and rotating the board. All lengths are in CSS
// pixels, relative to the board area.
import type { Position } from './types'

export const MAX_CELL_SIZE = 48

export interface Size {
  width: number
  height: number
}

export interface Point {
  x: number
  y: number
}

/** The board as it is drawn, so already rotated if it has to be. */
export interface Grid {
  cols: number
  rows: number
}

export interface Viewport {
  /** The size of a cell. */
  scale: number
  /** Where the top-left corner of the board is. */
  x: number
  y: number
}

export function shouldRotate(area: Size): boolean {
  return area.height > area.width
}

/** `board` is the size of the board in cells, before any rotation. */
export function displayGrid(board: Size, rotated: boolean): Grid {
  return rotated
    ? { cols: board.height, rows: board.width }
    : { cols: board.width, rows: board.height }
}

/** Where a cell is drawn. Rotating turns the board a quarter turn clockwise. */
export function displayPosition(
  cell: Position,
  board: Size,
  rotated: boolean,
): Position {
  return rotated ? { row: cell.col, col: board.height - 1 - cell.row } : cell
}

/** Which cell is drawn at a place on screen: undoes `displayPosition`. */
export function boardPosition(
  shown: Position,
  board: Size,
  rotated: boolean,
): Position {
  return rotated
    ? { row: board.height - 1 - shown.col, col: shown.row }
    : shown
}

function fitScale(grid: Grid, area: Size): number {
  return Math.min(area.width / grid.cols, area.height / grid.rows)
}

/** The whole board, as big as the area allows. */
export function fitView(grid: Grid, area: Size): Viewport {
  return clamp({ scale: fitScale(grid, area), x: 0, y: 0 }, grid, area)
}

/** Zoom by a factor, keeping what is under `anchor` where it is. */
export function zoomAt(
  view: Viewport,
  factor: number,
  anchor: Point,
  grid: Grid,
  area: Size,
): Viewport {
  const min = fitScale(grid, area)
  const max = Math.max(MAX_CELL_SIZE, min)
  const scale = between(view.scale * factor, min, max)
  const ratio = scale / view.scale
  return clamp(
    {
      scale,
      x: anchor.x - (anchor.x - view.x) * ratio,
      y: anchor.y - (anchor.y - view.y) * ratio,
    },
    grid,
    area,
  )
}

/** Zoom by a factor about the center of the area. */
export function zoomBy(
  view: Viewport,
  factor: number,
  grid: Grid,
  area: Size,
): Viewport {
  const center = { x: area.width / 2, y: area.height / 2 }
  return zoomAt(view, factor, center, grid, area)
}

export function panBy(
  view: Viewport,
  dx: number,
  dy: number,
  grid: Grid,
  area: Size,
): Viewport {
  return clamp({ ...view, x: view.x + dx, y: view.y + dy }, grid, area)
}

type Fingers = readonly [Point, Point]

/** Follow two fingers: they zoom as they spread and drag as they move. */
export function pinch(
  view: Viewport,
  from: Fingers,
  to: Fingers,
  grid: Grid,
  area: Size,
): Viewport {
  const start = midpoint(from)
  const end = midpoint(to)
  const spread = distance(from)
  const factor = spread === 0 ? 1 : distance(to) / spread
  const zoomed = zoomAt(view, factor, start, grid, area)
  return panBy(zoomed, end.x - start.x, end.y - start.y, grid, area)
}

/** Bring cells, given where they are drawn, into view if any is off screen. */
export function reveal(
  view: Viewport,
  cells: Position[],
  grid: Grid,
  area: Size,
): Viewport {
  const cols = cells.map((cell) => cell.col)
  const rows = cells.map((cell) => cell.row)
  const left = view.x + Math.min(...cols) * view.scale
  const right = view.x + (Math.max(...cols) + 1) * view.scale
  const top = view.y + Math.min(...rows) * view.scale
  const bottom = view.y + (Math.max(...rows) + 1) * view.scale
  const visible =
    left >= 0 && top >= 0 && right <= area.width && bottom <= area.height
  if (visible) return view
  return panBy(
    view,
    area.width / 2 - (left + right) / 2,
    area.height / 2 - (top + bottom) / 2,
    grid,
    area,
  )
}

// A side that fits is centered. A longer one never leaves a gap at either end.
function clamp(view: Viewport, grid: Grid, area: Size): Viewport {
  const axis = (offset: number, board: number, room: number) =>
    board <= room ? (room - board) / 2 : between(offset, room - board, 0)
  return {
    scale: view.scale,
    x: axis(view.x, grid.cols * view.scale, area.width),
    y: axis(view.y, grid.rows * view.scale, area.height),
  }
}

function between(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function midpoint([a, b]: Fingers): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}

function distance([a, b]: Fingers): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}
