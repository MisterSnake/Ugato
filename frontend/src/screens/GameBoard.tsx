import { memo, useEffect, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent } from 'react'
import { cellLook } from '../game/cellLook'
import { createTapDetector } from '../game/tapDetector'
import type { Color, GameState, Player, Position } from '../game/types'
import {
  boardPosition,
  displayGrid,
  displayPosition,
  fitView,
  panBy,
  pinch,
  reveal,
  shouldRotate,
  zoomBy,
} from '../game/viewport'
import type { Grid, Point, Size, Viewport } from '../game/viewport'
import { colorLabel } from './colorLabel'

// The size cells are laid out at. Zooming scales the whole board from it.
const CELL_SIZE = 32
const ZOOM_STEP = 1.5
const UNMEASURED: Viewport = { scale: CELL_SIZE, x: 0, y: 0 }

interface GameBoardProps {
  state: GameState
  players: Player[]
  /** The user's color while it is their turn. */
  turnColor: Color | null
  selected: Position | null
  /** The U on offer. It is highlighted and every other cell dimmed. */
  candidate: Position[] | null
  onTap: (cell: Position, pointerType: string) => void
}

interface Layout {
  /** The board area, once it has been measured. */
  area: Size | null
  /** How the user zoomed and panned. `null` keeps the board fitted. */
  custom: Viewport | null
  /** The U and area that were last brought into view. */
  revealed: string
}

function viewOf({ area, custom }: Layout, grid: Grid): Viewport {
  if (!area) return UNMEASURED
  // A factor of 1 keeps a custom view within the limits of the current area.
  return custom ? zoomBy(custom, 1, grid, area) : fitView(grid, area)
}

function samePosition(a: Position | null, b: Position): boolean {
  return a?.row === b.row && a.col === b.col
}

export function GameBoard({
  state,
  players,
  turnColor,
  selected,
  candidate,
  onTap,
}: GameBoardProps) {
  const areaRef = useRef<HTMLDivElement>(null)
  const [layout, setLayout] = useState<Layout>({
    area: null,
    custom: null,
    revealed: '',
  })
  const [detector] = useState(createTapDetector)
  // Where each pointer that is down was last seen.
  const pointers = useRef(new Map<number, Point>())
  const pressed = useRef<Position | null>(null)

  const size = { width: state.board[0].length, height: state.board.length }
  const rotated = layout.area !== null && shouldRotate(layout.area)
  const grid = displayGrid(size, rotated)
  const view = viewOf(layout, grid)

  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      if (width === 0 || height === 0) return
      const area = { width, height }
      setLayout((current) => {
        const turned =
          current.area !== null &&
          shouldRotate(current.area) !== shouldRotate(area)
        return { ...current, area, custom: turned ? null : current.custom }
      })
    })
    observer.observe(areaRef.current!)
    return () => observer.disconnect()
  }, [])

  // Only when another U is shown or the area changes, so the user can pan away.
  // Adjusted while rendering, so the U is never drawn off screen first.
  const revealKey = JSON.stringify([candidate, layout.area])
  if (revealKey !== layout.revealed) {
    let { custom } = layout
    if (candidate && layout.area) {
      const shown = candidate.map((cell) => displayPosition(cell, size, rotated))
      const next = reveal(view, shown, grid, layout.area)
      if (next !== view) custom = next
    }
    setLayout({ ...layout, custom, revealed: revealKey })
  }

  function changeView(change: (view: Viewport, area: Size) => Viewport) {
    setLayout((current) =>
      current.area
        ? { ...current, custom: change(viewOf(current, grid), current.area) }
        : current,
    )
  }

  const zoom = (factor: number) =>
    changeView((from, area) => zoomBy(from, factor, grid, area))

  /** Where a pointer is, relative to the inside of the board area. */
  function pointOf(event: PointerEvent<HTMLDivElement>): Point {
    const area = event.currentTarget
    const bounds = area.getBoundingClientRect()
    return {
      x: event.clientX - bounds.left - area.clientLeft,
      y: event.clientY - bounds.top - area.clientTop,
    }
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    // Keeps the pointer's events coming if it leaves the board area.
    event.currentTarget.setPointerCapture?.(event.pointerId)
    // The cell is taken now: with capture, later events do not target it.
    if (pointers.current.size === 0) {
      const cell = (event.target as Element).closest<HTMLElement>('[data-row]')
      pressed.current = cell && {
        row: Number(cell.dataset.row),
        col: Number(cell.dataset.col),
      }
    }
    const at = pointOf(event)
    pointers.current.set(event.pointerId, at)
    detector.down(event.pointerId, at)
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    const from = pointers.current.get(event.pointerId)
    if (!from) return
    const to = pointOf(event)
    const before = [...pointers.current.values()]
    pointers.current.set(event.pointerId, to)
    const gesture = detector.move(event.pointerId, to)
    const after = [...pointers.current.values()]
    if (after.length > 1) {
      changeView((current, area) =>
        pinch(
          current,
          [before[0], before[1]],
          [after[0], after[1]],
          grid,
          area,
        ),
      )
    } else if (gesture !== 'tap') {
      changeView((current, area) =>
        panBy(current, to.x - from.x, to.y - from.y, grid, area),
      )
    }
  }

  function handlePointerUp(event: PointerEvent<HTMLDivElement>) {
    if (!pointers.current.delete(event.pointerId)) return
    const gesture = detector.up(event.pointerId, pointOf(event))
    if (gesture === 'tap' && pressed.current) {
      onTap(pressed.current, event.pointerType)
    }
  }

  function handlePointerCancel(event: PointerEvent<HTMLDivElement>) {
    pointers.current.delete(event.pointerId)
    detector.cancel(event.pointerId)
  }

  return (
    <>
      <div
        ref={areaRef}
        data-testid="board-area"
        className={
          turnColor ? `board-area my-turn color-${turnColor}` : 'board-area'
        }
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
      >
        <div
          data-testid="board"
          className="board"
          style={
            {
              gridTemplateColumns: `repeat(${grid.cols}, ${CELL_SIZE}px)`,
              transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale / CELL_SIZE})`,
              // One screen pixel, whatever the zoom.
              '--hairline': `${CELL_SIZE / view.scale}px`,
            } as CSSProperties
          }
        >
          <Cells
            state={state}
            players={players}
            rotated={rotated}
            selected={selected}
            candidate={candidate}
          />
        </div>
      </div>
      <div className="zoom">
        <button type="button" onClick={() => zoom(1 / ZOOM_STEP)}>
          -
        </button>
        <button
          type="button"
          onClick={() => setLayout({ ...layout, custom: null })}
        >
          Fit
        </button>
        <button type="button" onClick={() => zoom(ZOOM_STEP)}>
          +
        </button>
      </div>
    </>
  )
}

type CellsProps = Pick<
  GameBoardProps,
  'state' | 'players' | 'selected' | 'candidate'
> & { rotated: boolean }

// Memoized: panning moves the board without changing any of its 900 cells.
const Cells = memo(function Cells({
  state,
  players,
  rotated,
  selected,
  candidate,
}: CellsProps) {
  const size = { width: state.board[0].length, height: state.board.length }
  const grid = displayGrid(size, rotated)
  const colors = new Map(players.map(({ name, color }) => [name, color]))

  return Array.from({ length: grid.cols * grid.rows }, (_, index) => {
    const shown = {
      row: Math.floor(index / grid.cols),
      col: index % grid.cols,
    }
    const position = boardPosition(shown, size, rotated)
    const { row, col } = position
    const cell = state.board[row][col]
    const { look, isLastMove } = cellLook(
      cell,
      state.leftPlayers,
      state.lastMove,
      position,
    )
    const color = cell && colors.get(cell.owner)
    const isCandidate = candidate?.some((other) =>
      samePosition(other, position),
    )
    const classes = [
      'cell',
      look,
      color && `color-${color}`,
      isLastMove && 'last-move',
      samePosition(selected, position) && 'selected',
      candidate && (isCandidate ? 'candidate' : 'dimmed'),
    ]
    const label = [
      `Row ${row + 1}, column ${col + 1}`,
      cell ? cell.owner : 'empty',
      color && colorLabel(color),
      cell?.disabled && 'disabled',
      isLastMove && 'last move',
    ]
    return (
      <div
        key={`${row}-${col}`}
        role="img"
        aria-label={label.filter(Boolean).join(', ')}
        className={classes.filter(Boolean).join(' ')}
        data-row={row}
        data-col={col}
      />
    )
  })
})
