import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Cell, GameState, Player, Position, Vote } from '../game/types'
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
    onPropose: vi.fn(),
    onVote: vi.fn(),
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

  it('sets the running clock apart from the others', () => {
    renderGame({
      timer: 'fast',
      clocks: { Ana: 20_000, Esteban: 30_000 },
    })
    const clock = (time: string) => screen.getByText(time)

    expect(clock('0:20')).toHaveClass('clock', 'running')
    expect(clock('0:30')).not.toHaveClass('running')
  })

  it('styles leaving as dangerous and the secondary buttons as ghosts', () => {
    renderGame(myTurn)

    expect(button('Leave game')).toHaveClass('btn-danger')
    for (const name of ['Propose ending (2 left)', '-', 'Fit', '+']) {
      expect(button(name)).toHaveClass('btn-ghost')
    }
  })
})

describe('GameScreen turn bar', () => {
  it("shows another player's turn with their name and color", () => {
    renderGame()

    expect(turnBar()).toHaveTextContent("Ana's turn")
    expect(turnBar()).toHaveTextContent('Ana (Blue)')
    expect(turnBar()).toHaveClass('color-blue')
    expect(boardArea()).not.toHaveClass('my-turn')
    expect(document.title).toBe('U Cat')
  })

  it("makes the user's own turn unmistakable", () => {
    renderGame(myTurn)

    expect(turnBar()).toHaveTextContent('Your turn!')
    expect(turnBar()).toHaveTextContent('Esteban (Red)')
    expect(boardArea()).toHaveClass('my-turn', 'color-red')
    expect(document.title).toBe('Your turn! - U Cat')
  })

  it('drops the turn from the title once it passes or the screen closes', () => {
    document.title = 'Before'
    const { update, unmount } = renderGame(myTurn)

    update({ currentPlayer: 'Ana' })
    expect(document.title).toBe('U Cat')

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

const openVote: Vote = {
  proposer: 'Ana',
  voted: 1,
  total: 3,
  secondsLeft: 30,
  yourVote: null,
}
const attempts = (mine: number) => ({
  endProposalsLeft: { Esteban: mine, Ana: 2, Luis: 2 },
})

describe('GameScreen proposing to end', () => {
  it("sends the proposal from the turn bar on the user's turn", async () => {
    const { user, onPropose } = renderGame({ ...myTurn, ...attempts(2) })

    await user.click(
      within(turnBar()).getByRole('button', {
        name: 'Propose ending (2 left)',
      }),
    )

    expect(onPropose).toHaveBeenCalledOnce()
  })

  const queryPropose = () =>
    screen.queryByRole('button', { name: /^Propose ending/ })

  it('is hidden while a touch selection waits for "Mark"', () => {
    renderGame(myTurn)

    press(2, 3, 'touch')

    expect(button('Mark')).toBeInTheDocument()
    expect(queryPropose()).not.toBeInTheDocument()
  })

  it('is back after tapping the selected cell again', () => {
    renderGame(myTurn)
    press(2, 3, 'touch')

    press(2, 3, 'touch')

    expect(queryPropose()).toBeInTheDocument()
  })

  it('is back after pressing "Mark"', async () => {
    const { user } = renderGame(myTurn)
    press(2, 3, 'touch')

    await user.click(button('Mark'))

    expect(queryPropose()).toBeInTheDocument()
  })

  it('is back when the selection can no longer be marked', () => {
    const { update } = renderGame(myTurn)
    press(2, 3, 'touch')

    update({ currentPlayer: 'Ana' })

    expect(queryButton('Mark')).not.toBeInTheDocument()
    expect(queryPropose()).toBeInTheDocument()
  })

  it('is never hidden by a mouse click', () => {
    renderGame(myTurn)

    press(2, 3)

    expect(queryPropose()).toBeInTheDocument()
  })

  it.each<[string, Partial<GameState>, number]>([
    ['out of turn', { currentPlayer: 'Ana' }, 2],
    ['while choosing a U', { ...myTurn, phase: 'choose' }, 2],
    ['during a vote', { ...myTurn, vote: openVote }, 1],
    ['without attempts', myTurn, 0],
  ])('is disabled %s', (_, state, left) => {
    renderGame({ ...state, ...attempts(left) })

    expect(button(`Propose ending (${left} left)`)).toBeDisabled()
  })
})

const panel = () =>
  screen.getByRole('region', { name: 'Vote to end the game' })

describe('GameScreen voting panel', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('is only shown while a vote is open', () => {
    renderGame()

    expect(
      screen.queryByRole('region', { name: 'Vote to end the game' }),
    ).not.toBeInTheDocument()
  })

  it('shows who proposed, the progress and the time left', () => {
    renderGame({ vote: openVote })

    expect(panel()).toHaveTextContent('Ana wants to end the game')
    expect(panel()).toHaveTextContent('1 of 3 voted')
    expect(panel()).toHaveTextContent('30 s left')
  })

  it.each([
    ['End game', true],
    ['Keep playing', false],
  ])('votes with "%s"', async (name, end) => {
    const { user, onVote } = renderGame({ vote: openVote })

    await user.click(within(panel()).getByRole('button', { name }))

    expect(onVote).toHaveBeenCalledExactlyOnceWith(end)
  })

  it('replaces the buttons with a note once the user has voted', () => {
    const { update } = renderGame({ vote: openVote })

    update({ vote: { ...openVote, voted: 2, yourVote: 'continue' } })

    expect(panel()).toHaveTextContent('You have voted.')
    expect(queryButton('End game')).not.toBeInTheDocument()
    expect(queryButton('Keep playing')).not.toBeInTheDocument()
    expect(panel()).not.toHaveTextContent('continue')
  })

  it('lets the proposer only wait', () => {
    renderGame(
      { vote: { ...openVote, proposer: 'Esteban', yourVote: 'end' } },
      'Esteban',
    )

    expect(panel()).toHaveTextContent('You proposed ending the game')
    expect(panel()).toHaveTextContent('30 s left')
    expect(panel()).not.toHaveTextContent('You have voted.')
    expect(queryButton('End game')).not.toBeInTheDocument()
    expect(queryButton('Keep playing')).not.toBeInTheDocument()
  })

  it('counts down, and starts again from each new state', () => {
    vi.useFakeTimers()
    const { update } = renderGame({ vote: openVote })

    act(() => vi.advanceTimersByTime(3_000))
    expect(panel()).toHaveTextContent('27 s left')

    update({ vote: { ...openVote, voted: 2, secondsLeft: 20 } })
    expect(panel()).toHaveTextContent('20 s left')
    act(() => vi.advanceTimersByTime(2_000))
    expect(panel()).toHaveTextContent('18 s left')

    act(() => vi.advanceTimersByTime(60_000))
    expect(panel()).toHaveTextContent('0 s left')
  })

  it("keeps the board inert on the user's turn", () => {
    const { onMark } = renderGame({ ...myTurn, vote: openVote })

    press(2, 3)
    press(2, 3, 'touch')

    expect(onMark).not.toHaveBeenCalled()
    expect(cellAt(2, 3)).not.toHaveClass('selected')
    expect(queryButton('Mark')).not.toBeInTheDocument()
  })
})

const listedScores = () =>
  within(screen.getByRole('list', { name: 'Players' }))
    .getAllByRole('listitem')
    .map((item) => item.textContent)

const slowGame: Partial<GameState> = {
  timer: 'slow',
  clocks: { Ana: 75_000, Esteban: 9_400 },
}

describe('GameScreen player clocks', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows the time of each player next to their score', () => {
    renderGame(slowGame)

    expect(listedScores()).toEqual(['Ana 0 1:15', 'Esteban 0 9.4'])
  })

  it('counts down only the clock of the current player', () => {
    vi.useFakeTimers()
    renderGame(slowGame)

    act(() => vi.advanceTimersByTime(5_000))

    expect(listedScores()).toEqual(['Ana 0 1:10', 'Esteban 0 9.4'])
  })

  it('shows tenths as they pass and stops at zero', () => {
    vi.useFakeTimers()
    renderGame({ ...slowGame, currentPlayer: 'Esteban' })

    act(() => vi.advanceTimersByTime(300))
    expect(listedScores()).toContain('Esteban 0 9.1')

    act(() => vi.advanceTimersByTime(60_000))
    expect(listedScores()).toContain('Esteban 0 0.0')
  })

  it('starts again from each new state', () => {
    vi.useFakeTimers()
    const { update } = renderGame(slowGame)
    act(() => vi.advanceTimersByTime(5_000))

    update({ ...slowGame, clocks: { Ana: 40_000, Esteban: 9_400 } })

    expect(listedScores()).toContain('Ana 0 0:40')
    act(() => vi.advanceTimersByTime(2_000))
    expect(listedScores()).toContain('Ana 0 0:38')
  })

  it('does not move a clock while a vote is open', () => {
    vi.useFakeTimers()
    renderGame({
      timer: 'normal',
      clocks: { Ana: 30_000, Esteban: 21_000 },
      currentPlayer: 'Esteban',
      vote: { ...openVote, proposer: 'Esteban' },
    })

    act(() => vi.advanceTimersByTime(5_000))

    expect(listedScores()).toContain('Esteban 0 0:21')
  })

  it('keeps no interval when no clock runs, or once it is closed', () => {
    vi.useFakeTimers()
    const { update, unmount } = renderGame(slowGame)
    expect(vi.getTimerCount()).toBe(1)

    update({ ...slowGame, phase: 'choose' })
    expect(vi.getTimerCount()).toBe(0)

    update(slowGame)
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('shows no clock in an untimed game', () => {
    renderGame()

    expect(listedScores()).toEqual(['Ana 0', 'Esteban 0'])
  })
})

describe('GameScreen timeout notice', () => {
  it.each([
    ['Esteban', 'Ana ran out of time'],
    ['Ana', 'You ran out of time'],
  ])('tells %s "%s"', (me, notice) => {
    render(
      <GameScreen
        state={makeState()}
        players={players}
        me={me}
        timedOut="Ana"
        onMark={vi.fn()}
        onChoose={vi.fn()}
        onPropose={vi.fn()}
        onVote={vi.fn()}
        onLeave={vi.fn()}
      />,
    )

    expect(screen.getByRole('status')).toHaveTextContent(notice)
  })

  it('says nothing when nobody ran out of time', () => {
    renderGame()

    expect(screen.queryByText(/ran out of time/)).not.toBeInTheDocument()
  })
})

const turnText = () =>
  within(screen.getByTestId('turn-bar')).getByText(/choos/i, {
    selector: 'p',
  })

const estebanChoosing: Partial<GameState> = {
  timer: 'normal',
  clocks: { Ana: 30_000, Esteban: 18_000 },
  currentPlayer: 'Esteban',
  phase: 'choose',
  chooseMsLeft: 5_000,
}

describe('GameScreen choose clock', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it.each([
    ['Ana', 'Esteban is choosing a U (5.0)', 'Esteban is choosing a U (3.0)'],
    ['Esteban', 'Choose a U (5.0)', 'Choose a U (3.0)'],
  ])('counts down for %s', (me, before, after) => {
    vi.useFakeTimers()
    renderGame(estebanChoosing, me)

    expect(turnText()).toHaveTextContent(before)
    act(() => vi.advanceTimersByTime(2_000))

    expect(turnText()).toHaveTextContent(after)
  })

  it('stands still outside its own clock, which stays frozen', () => {
    vi.useFakeTimers()
    renderGame(estebanChoosing, 'Ana')

    act(() => vi.advanceTimersByTime(2_000))

    expect(listedScores()).toContain('Esteban 0 0:18')
  })

  it('does not read every tick aloud', () => {
    renderGame(estebanChoosing, 'Ana')

    expect(screen.getByText('(5.0)')).toHaveAttribute('aria-hidden', 'true')
  })

  it('keeps the candidate count next to the time', () => {
    renderGame({ ...estebanChoosing, candidates: [[], []] }, 'Esteban')

    expect(screen.getByTestId('turn-bar')).toHaveTextContent('Choose a U (5.0)')
  })

  it('shows no time in an untimed game', () => {
    renderGame({ currentPlayer: 'Esteban', phase: 'choose' }, 'Ana')

    expect(turnText().textContent).toBe('Esteban is choosing a U')
  })
})
