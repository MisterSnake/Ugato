import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { Cell, GameState, Player, Position } from '../game/types'
import { FakeResizeObserver } from '../test/FakeResizeObserver'
import { emptyBoard, makeState } from '../test/gameState'
import { GameScreen } from './GameScreen'

const players: Player[] = [
  { name: 'Esteban', color: 'red' },
  { name: 'Ana', color: 'blue' },
  { name: 'Luis', color: 'green' },
]

type Props = ComponentProps<typeof GameScreen>

function renderGame(state: Partial<GameState> = {}, me = 'Esteban') {
  const props: Props = {
    state: makeState(state),
    players,
    me,
    onLeave: vi.fn(),
    onMark: vi.fn(),
    onChoose: vi.fn(),
  }
  const view = render(<GameScreen {...props} />)
  const update = (next: Partial<GameState>) =>
    view.rerender(<GameScreen {...props} state={makeState(next)} />)
  return { ...view, ...props, update, user: userEvent.setup() }
}

const myTurn: Partial<GameState> = { currentPlayer: 'Esteban' }

function boardWith(cells: [number, number, Cell][]) {
  const board = emptyBoard(12, 10)
  for (const [row, col, cell] of cells) board[row][col] = cell
  return board
}

const allCells = () => [
  ...document.querySelectorAll<HTMLElement>('[data-row]'),
]

function cellAt(row: number, col: number): HTMLElement {
  const cell = document.querySelector<HTMLElement>(
    `[data-row="${row}"][data-col="${col}"]`,
  )
  if (!cell) throw new Error(`No cell at ${row}, ${col}`)
  return cell
}

type Pointer = { id?: number; type?: string; x?: number; y?: number }

function pointer(
  event: 'pointerDown' | 'pointerMove' | 'pointerUp',
  target: Element,
  { id = 1, type = 'mouse', x = 0, y = 0 }: Pointer = {},
) {
  fireEvent[event](target, {
    pointerId: id,
    pointerType: type,
    button: 0,
    clientX: x,
    clientY: y,
  })
}

function press(row: number, col: number, type = 'mouse') {
  pointer('pointerDown', cellAt(row, col), { type })
  pointer('pointerUp', cellAt(row, col), { type })
}

const button = (name: string) => screen.getByRole('button', { name })
const queryButton = (name: string) => screen.queryByRole('button', { name })
const turnBar = () => screen.getByTestId('turn-bar')
const boardArea = () => screen.getByTestId('board-area')
const board = () => screen.getByTestId('board')
const resize = (width: number, height: number) =>
  act(() => FakeResizeObserver.resize(width, height))

describe('GameScreen layout', () => {
  it('shows a board of identical empty cells', () => {
    renderGame()

    expect(allCells()).toHaveLength(120)
    expect(new Set(allCells().map((cell) => cell.className))).toEqual(
      new Set(['cell empty']),
    )
    expect(board().style.gridTemplateColumns).toBe('repeat(12, 32px)')
    expect(cellAt(9, 11)).toHaveAccessibleName('Row 10, column 12, empty')
  })

  it('lists the players in turn order with their color and score', () => {
    renderGame({
      turnOrder: ['Ana', 'Luis', 'Esteban'],
      scores: { Esteban: 2, Ana: 0, Luis: 1 },
      leftPlayers: ['Luis'],
    })

    const rows = within(
      screen.getByRole('list', { name: 'Players' }),
    ).getAllByRole('listitem')

    expect(rows.map((row) => row.textContent)).toEqual([
      'Ana 0',
      'Luis 1 (left)',
      'Esteban 2',
    ])
    expect(rows[0].querySelector('.swatch')).toHaveClass('color-blue')
  })

  it('offers to leave the game', async () => {
    const { user, onLeave } = renderGame()

    await user.click(button('Leave game'))

    expect(onLeave).toHaveBeenCalledOnce()
  })
})

describe('GameScreen turn bar', () => {
  it("shows another player's turn with their name and color", () => {
    renderGame()

    expect(turnBar()).toHaveTextContent("Ana's turn")
    expect(turnBar()).toHaveTextContent('Ana (Blue)')
    expect(turnBar()).toHaveClass('color-blue')
    expect(boardArea()).not.toHaveClass('my-turn')
    expect(document.title).toBe('Ugato')
  })

  it("makes the user's own turn unmistakable", () => {
    renderGame(myTurn)

    expect(turnBar()).toHaveTextContent('Your turn!')
    expect(turnBar()).toHaveTextContent('Esteban (Red)')
    expect(boardArea()).toHaveClass('my-turn', 'color-red')
    expect(document.title).toBe('Your turn! - Ugato')
  })

  it('drops the turn from the title once it passes or the screen closes', () => {
    document.title = 'Before'
    const { update, unmount } = renderGame(myTurn)

    update({ currentPlayer: 'Ana' })
    expect(document.title).toBe('Ugato')

    unmount()
    expect(document.title).toBe('Before')
  })

  it('says who is choosing a U', () => {
    renderGame({ phase: 'choose' })

    expect(turnBar()).toHaveTextContent('Ana is choosing a U')
  })

  it('stays outside the part that zooms', () => {
    renderGame()

    expect(board().contains(turnBar())).toBe(false)
    expect(boardArea().contains(turnBar())).toBe(false)
  })
})

describe('GameScreen cell styles', () => {
  const owned = (owner: string, disabled = false) => ({ owner, disabled })

  it('gives each cell its look, color and the last move marker', () => {
    renderGame({
      board: boardWith([
        [0, 0, owned('Esteban')],
        [0, 1, owned('Esteban', true)],
        [0, 2, owned('Luis')],
        [0, 3, owned('Luis', true)],
      ]),
      leftPlayers: ['Luis'],
      lastMove: { row: 0, col: 1 },
    })

    expect(cellAt(0, 0).className).toBe('cell taken color-red')
    expect(cellAt(0, 1).className).toBe('cell disabled color-red last-move')
    expect(cellAt(0, 2).className).toBe('cell left color-green')
    expect(cellAt(0, 3).className).toBe('cell left-disabled color-green')
    expect(cellAt(1, 0).className).toBe('cell empty')
    expect(cellAt(0, 1)).toHaveAccessibleName(
      'Row 1, column 2, Esteban, Red, disabled, last move',
    )
  })
})

describe('GameScreen marking', () => {
  it('marks at once with a mouse click', () => {
    const { onMark } = renderGame(myTurn)

    press(2, 3)

    expect(onMark).toHaveBeenCalledExactlyOnceWith(2, 3)
    expect(queryButton('Mark')).not.toBeInTheDocument()
  })

  it('ignores the other mouse buttons', () => {
    const { onMark } = renderGame(myTurn)

    fireEvent.pointerDown(cellAt(2, 3), {
      pointerId: 1,
      pointerType: 'mouse',
      button: 2,
    })
    pointer('pointerUp', cellAt(2, 3))

    expect(onMark).not.toHaveBeenCalled()
  })

  it.each(['touch', 'pen'])('needs a confirmation for a %s tap', async (type) => {
    const { onMark, user } = renderGame(myTurn)

    press(2, 3, type)

    expect(cellAt(2, 3)).toHaveClass('selected')
    expect(onMark).not.toHaveBeenCalled()
    await user.click(button('Mark'))

    expect(onMark).toHaveBeenCalledExactlyOnceWith(2, 3)
    expect(cellAt(2, 3)).not.toHaveClass('selected')
    expect(queryButton('Mark')).not.toBeInTheDocument()
  })

  it('moves the selection, and clears it on a second tap', () => {
    renderGame(myTurn)
    press(2, 3, 'touch')

    press(4, 4, 'touch')
    expect(cellAt(2, 3)).not.toHaveClass('selected')
    expect(cellAt(4, 4)).toHaveClass('selected')

    press(4, 4, 'touch')
    expect(cellAt(4, 4)).not.toHaveClass('selected')
    expect(queryButton('Mark')).not.toBeInTheDocument()
  })

  it('keeps the selection while the turn is still open', () => {
    const { update } = renderGame(myTurn)
    press(2, 3, 'touch')

    update({ ...myTurn, leftPlayers: ['Luis'] })

    expect(cellAt(2, 3)).toHaveClass('selected')
  })

  it.each<[string, Partial<GameState>]>([
    ['out of turn', { currentPlayer: 'Ana' }],
    ['while choosing a U', { ...myTurn, phase: 'choose' }],
    [
      'on a taken cell',
      {
        ...myTurn,
        board: boardWith([[2, 3, { owner: 'Ana', disabled: false }]]),
      },
    ],
  ])('does nothing %s', (_, state) => {
    const { onMark } = renderGame(state)

    press(2, 3)
    press(2, 3, 'touch')

    expect(onMark).not.toHaveBeenCalled()
    expect(cellAt(2, 3)).not.toHaveClass('selected')
    expect(queryButton('Mark')).not.toBeInTheDocument()
  })

  it.each(['touch', 'mouse'])('never marks after a %s pan', (type) => {
    const { onMark } = renderGame(myTurn)

    pointer('pointerDown', cellAt(2, 3), { type })
    pointer('pointerMove', cellAt(2, 3), { type, x: 40 })
    pointer('pointerUp', cellAt(2, 3), { type, x: 40 })

    expect(onMark).not.toHaveBeenCalled()
    expect(cellAt(2, 3)).not.toHaveClass('selected')
  })
})

const candidates: Position[][] = [0, 1, 2].map((start) =>
  [0, 1, 2, 3, 4].map((col) => ({ row: start, col: start + col })),
)
const choosing: Partial<GameState> = {
  ...myTurn,
  phase: 'choose',
  candidates,
}

const highlighted = () =>
  allCells()
    .filter((cell) => cell.classList.contains('candidate'))
    .map((cell) => ({
      row: Number(cell.dataset.row),
      col: Number(cell.dataset.col),
    }))

describe('GameScreen choosing a U', () => {
  it('highlights the first candidate and dims the other cells', () => {
    renderGame(choosing)

    expect(turnBar()).toHaveTextContent('Choose your U (1 of 3)')
    expect(highlighted()).toEqual(candidates[0])
    expect(
      allCells().filter((cell) => cell.classList.contains('dimmed')),
    ).toHaveLength(115)
  })

  it('cycles through the candidates and confirms the one shown', async () => {
    const { user, onChoose } = renderGame(choosing)

    await user.click(button('Next'))
    expect(turnBar()).toHaveTextContent('Choose your U (2 of 3)')
    expect(highlighted()).toEqual(candidates[1])
    await user.click(button('Previous'))
    expect(turnBar()).toHaveTextContent('(1 of 3)')
    await user.click(button('Previous'))
    expect(turnBar()).toHaveTextContent('(3 of 3)')
    await user.click(button('Next'))
    await user.click(button('Next'))
    await user.click(button('Confirm'))

    expect(onChoose).toHaveBeenCalledExactlyOnceWith(1)
  })

  it('starts at the first candidate of a new choice', async () => {
    const { user, update } = renderGame(choosing)
    await user.click(button('Next'))

    update(myTurn)
    update({ ...choosing, candidates: [candidates[2], candidates[1]] })

    expect(turnBar()).toHaveTextContent('(1 of 2)')
  })

  it('shows the others only that someone is choosing', () => {
    renderGame({ phase: 'choose' })

    expect(turnBar()).toHaveTextContent('Ana is choosing a U')
    for (const name of ['Previous', 'Next', 'Confirm']) {
      expect(queryButton(name)).not.toBeInTheDocument()
    }
    expect(highlighted()).toEqual([])
    expect(document.querySelector('.dimmed')).toBeNull()
  })
})

// A 12 x 10 board fits 400 x 300 at 30px per cell, 20px from the left.
const FITTED = 'translate(20px) scale(0.9375)'
const ZOOMED = 'translate(-70px, -75px) scale(1.40625)'

describe('GameScreen zoom, pan and rotation', () => {
  it('starts fitted to the board area', () => {
    renderGame()

    resize(400, 300)

    expect(board().style.transform).toBe(FITTED)
  })

  it('zooms with the buttons and fits again', async () => {
    const { user } = renderGame()
    resize(400, 300)

    await user.click(button('+'))
    expect(board().style.transform).toBe(ZOOMED)
    await user.click(button('-'))
    expect(board().style.transform).toBe(FITTED)
    await user.click(button('+'))
    await user.click(button('Fit'))
    expect(board().style.transform).toBe(FITTED)
  })

  it('keeps borders one screen pixel wide at any zoom', () => {
    renderGame()

    resize(400, 300)

    expect(board().style.getPropertyValue('--hairline')).toBe(
      `${32 / 30}px`,
    )
  })

  it('pans a zoomed board by dragging, without marking', async () => {
    const { user, onMark } = renderGame(myTurn)
    resize(400, 300)
    await user.click(button('+'))

    pointer('pointerDown', cellAt(2, 3), { type: 'touch', x: 100, y: 100 })
    pointer('pointerMove', cellAt(2, 3), { type: 'touch', x: 130, y: 110 })
    pointer('pointerUp', cellAt(2, 3), { type: 'touch', x: 130, y: 110 })

    expect(board().style.transform).toBe(
      'translate(-40px, -65px) scale(1.40625)',
    )
    expect(onMark).not.toHaveBeenCalled()
    expect(queryButton('Mark')).not.toBeInTheDocument()
  })

  it('zooms with a pinch, without marking', () => {
    const { onMark } = renderGame(myTurn)
    resize(400, 300)

    pointer('pointerDown', cellAt(5, 4), { id: 1, type: 'touch', x: 150, y: 150 })
    pointer('pointerDown', cellAt(5, 6), { id: 2, type: 'touch', x: 250, y: 150 })
    pointer('pointerMove', cellAt(5, 4), { id: 1, type: 'touch', x: 125, y: 150 })
    pointer('pointerMove', cellAt(5, 6), { id: 2, type: 'touch', x: 275, y: 150 })
    pointer('pointerUp', cellAt(5, 4), { id: 1, type: 'touch', x: 125, y: 150 })
    pointer('pointerUp', cellAt(5, 6), { id: 2, type: 'touch', x: 275, y: 150 })

    // The fingers ended 1.5 times as far apart, around the same point.
    const scale = Number(/scale\((.+)\)/.exec(board().style.transform)?.[1])
    expect(scale).toBeCloseTo(1.40625)
    expect(onMark).not.toHaveBeenCalled()
    expect(queryButton('Mark')).not.toBeInTheDocument()
  })

  it('rotates the board in a tall area and keeps cell coordinates', () => {
    const { onMark } = renderGame(myTurn)

    resize(300, 400)

    expect(board().style.gridTemplateColumns).toBe('repeat(10, 32px)')
    // The bottom-left cell of the board is drawn at the top left.
    const [first] = allCells()
    expect([first.dataset.row, first.dataset.col]).toEqual(['9', '0'])
    press(9, 0)
    expect(onMark).toHaveBeenCalledExactlyOnceWith(9, 0)
  })

  it('resets the zoom when the screen rotates', async () => {
    const { user } = renderGame()
    resize(400, 300)
    await user.click(button('+'))

    resize(300, 400)
    // 10 columns by 12 rows fit 300 x 400 at 30px per cell.
    expect(board().style.transform).toBe('translate(0px, 20px) scale(0.9375)')
    resize(400, 300)

    expect(board().style.transform).toBe(FITTED)
  })

  it('brings the candidate shown into view', async () => {
    const { user, update } = renderGame(myTurn)
    resize(400, 300)
    await user.click(button('+'))
    await user.click(button('+'))
    const bottomRight = [
      { row: 8, col: 9 },
      { row: 8, col: 11 },
      { row: 9, col: 9 },
      { row: 9, col: 10 },
      { row: 9, col: 11 },
    ]
    const topLeft = [
      { row: 0, col: 0 },
      { row: 0, col: 2 },
      { row: 1, col: 0 },
      { row: 1, col: 1 },
      { row: 1, col: 2 },
    ]

    update({ ...choosing, candidates: [bottomRight, topLeft] })

    // As far toward the bottom right as panning allows, at 48px per cell.
    expect(board().style.transform).toBe(
      'translate(-176px, -180px) scale(1.5)',
    )
    await user.click(button('Next'))
    expect(board().style.transform).toBe('translate(0px) scale(1.5)')
  })
})
