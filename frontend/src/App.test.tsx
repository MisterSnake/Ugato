import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StrictMode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { createGameSocket } from './game/gameSocket'
import type { GameSocketFactory } from './game/gameSocket'
import type { GameSummary } from './game/types'
import { FakeWebSocket } from './test/FakeWebSocket'
import { makeState } from './test/gameState'

const game: GameSummary = {
  name: 'Partida 1',
  maxPlayers: 2,
  boardWidth: 12,
  boardHeight: 10,
  status: 'waiting',
  players: [{ name: 'Esteban', color: 'red' }],
}

const fakeSocketFactory: GameSocketFactory = (url) =>
  createGameSocket(url, FakeWebSocket)

function renderApp() {
  const view = render(
    <StrictMode>
      <App createSocket={fakeSocketFactory} />
    </StrictMode>,
  )
  return { ...view, user: userEvent.setup() }
}

function receiveGames(server: FakeWebSocket, games: GameSummary[] = []) {
  receive(server, { type: 'games_list', games })
}

// StrictMode opens, closes and reopens; the latest socket is the live one.
function renderLobby() {
  const app = renderApp()
  const server = FakeWebSocket.latest
  act(() => server.simulateOpen())
  receiveGames(server)
  return { ...app, server }
}

async function fillAndSubmitForm(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Create game' }))
  await user.type(screen.getByLabelText('Your name'), 'Esteban')
  await user.click(screen.getByRole('radio', { name: 'Red' }))
  await user.type(screen.getByLabelText('Game name'), 'Partida 1')
  await user.clear(screen.getByLabelText('Board width'))
  await user.type(screen.getByLabelText('Board width'), '12')
  await user.clear(screen.getByLabelText('Board height'))
  await user.type(screen.getByLabelText('Board height'), '10')
  await user.click(screen.getByRole('button', { name: 'Create' }))
}

async function submitForm() {
  const app = renderLobby()
  await fillAndSubmitForm(app.user)
  return app
}

function receive(server: FakeWebSocket, message: object) {
  act(() => server.simulateMessage(message))
}

beforeEach(() => {
  FakeWebSocket.instances = []
  window.sessionStorage.clear()
})

describe('App flow', () => {
  it('creates exactly one socket and subscribes on load', () => {
    render(<App createSocket={fakeSocketFactory} />)

    expect(FakeWebSocket.instances).toHaveLength(1)
    const [server] = FakeWebSocket.instances
    act(() => server.simulateOpen())

    expect(server.url).toBe(`ws://${window.location.host}/api/ws`)
    expect(server.sent).toEqual([{ type: 'subscribe_lobby' }])
  })

  it('keeps only one socket open under StrictMode', () => {
    renderApp()

    expect(
      FakeWebSocket.instances.filter((socket) => !socket.closed),
    ).toEqual([FakeWebSocket.latest])
  })

  it('shows the games once the first list arrives', () => {
    renderApp()
    const server = FakeWebSocket.latest
    act(() => server.simulateOpen())

    expect(screen.getByText('Loading games...')).toBeInTheDocument()
    expect(createGameButton()).toBeDisabled()
    receiveGames(server, [game])

    expect(screen.getByText('Partida 1')).toBeInTheDocument()
    expect(screen.queryByText('Loading games...')).not.toBeInTheDocument()
    expect(createGameButton()).toBeEnabled()
  })

  it('replaces the list with each new one', () => {
    const { server } = renderLobby()
    receiveGames(server, [game])

    receiveGames(server)

    expect(screen.queryByText('Partida 1')).not.toBeInTheDocument()
    expect(screen.getByText('No games yet. Create one!')).toBeInTheDocument()
  })

  it('sends the form data over the socket', async () => {
    const { server } = await submitForm()

    expect(server.sent.slice(1)).toEqual([
      {
        type: 'create_game',
        username: 'Esteban',
        color: 'red',
        gameName: 'Partida 1',
        maxPlayers: 2,
        boardWidth: 12,
        boardHeight: 10,
      },
    ])
  })

  it('creates the game without opening a new socket', async () => {
    const createSocket = vi.fn(fakeSocketFactory)
    const user = userEvent.setup()
    render(<App createSocket={createSocket} />)
    const server = FakeWebSocket.latest
    act(() => server.simulateOpen())
    receiveGames(server)

    await fillAndSubmitForm(user)

    expect(createSocket).toHaveBeenCalledOnce()
    expect(server.sent).toMatchObject([
      { type: 'subscribe_lobby' },
      { type: 'create_game' },
    ])
  })

  it('locks the user in the waiting screen once the game is created', async () => {
    const { server } = await submitForm()

    receive(server, { type: 'game_created', game })

    expect(screen.getByText('Waiting for players...')).toBeInTheDocument()
    expect(
      screen.getAllByRole('button').map((button) => button.textContent),
    ).toEqual(['Cancel game'])
  })

  it('reuses the open socket when the form is submitted again', async () => {
    const { server, user } = await submitForm()
    receive(server, { type: 'error', field: 'gameName', code: 'name_taken' })

    await user.type(screen.getByLabelText('Game name'), '2')
    await user.click(screen.getByRole('button', { name: 'Create' }))

    expect(server.sent).toMatchObject([
      { type: 'subscribe_lobby' },
      { type: 'create_game', gameName: 'Partida 1' },
      { type: 'create_game', gameName: 'Partida 12' },
    ])
  })

  it('closes the socket when it unmounts', async () => {
    const { server, unmount } = await submitForm()

    unmount()

    expect(server.closed).toBe(true)
  })
})

async function reachWaitingScreen() {
  const app = await submitForm()
  receive(app.server, { type: 'game_created', game })
  return app
}

const createGameButton = () =>
  screen.getByRole('button', { name: 'Create game' })

function expectDisconnectedLobby() {
  expect(screen.getByText("Can't reach the server.")).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  expect(createGameButton()).toBeDisabled()
}

describe('App cancel and lost connection', () => {
  it('returns to a current lobby over the same connection on cancel', async () => {
    const { server, user } = await reachWaitingScreen()
    const socketCount = FakeWebSocket.instances.length
    receiveGames(server, [{ ...game, name: 'Duel' }])

    await user.click(screen.getByRole('button', { name: 'Cancel game' }))

    expect(screen.getByText('Duel')).toBeInTheDocument()
    expect(createGameButton()).toBeEnabled()
    expect(server.closed).toBe(false)
    expect(FakeWebSocket.instances).toHaveLength(socketCount)
    expect(window.sessionStorage).toHaveLength(0)
  })

  it('creates the next game on the same connection after cancelling', async () => {
    const { server, user } = await reachWaitingScreen()
    await user.click(screen.getByRole('button', { name: 'Cancel game' }))

    await fillAndSubmitForm(user)

    expect(FakeWebSocket.latest).toBe(server)
    expect(server.sent.map((message) => (message as { type: string }).type))
      .toEqual(['subscribe_lobby', 'create_game', 'cancel_game', 'create_game'])
  })

  it('cancels the game and returns home with no notice', async () => {
    const { server, user } = await reachWaitingScreen()

    await user.click(screen.getByRole('button', { name: 'Cancel game' }))

    expect(server.sent.at(-1)).toEqual({ type: 'cancel_game' })
    expect(createGameButton()).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows the disconnected lobby when the connection is lost on it', () => {
    const { server } = renderLobby()
    receiveGames(server, [game])

    act(() => server.simulateServerClose())

    expectDisconnectedLobby()
    expect(screen.queryByText('Partida 1')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows the disconnected lobby if the server cannot be reached', () => {
    renderApp()

    act(() => FakeWebSocket.latest.simulateServerClose())

    expectDisconnectedLobby()
  })

  it('leaves the form for the disconnected lobby, with no notice', async () => {
    const { server, user } = renderLobby()
    await user.click(createGameButton())

    act(() => server.simulateServerClose())

    expectDisconnectedLobby()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('leaves the waiting screen with a notice', async () => {
    const { server } = await reachWaitingScreen()

    act(() => server.simulateServerClose())

    expectDisconnectedLobby()
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Connection lost, the game was removed',
    )
    expect(window.sessionStorage).toHaveLength(0)
  })

  it('does not reconnect on its own', () => {
    vi.useFakeTimers()
    try {
      const { server } = renderLobby()
      const socketCount = FakeWebSocket.instances.length
      act(() => server.simulateServerClose())

      act(() => vi.advanceTimersByTime(10 * 60 * 1000))

      expect(FakeWebSocket.instances).toHaveLength(socketCount)
      expectDisconnectedLobby()
    } finally {
      vi.useRealTimers()
    }
  })

  it('connects and subscribes again on Retry', async () => {
    const { server, user } = renderLobby()
    const socketCount = FakeWebSocket.instances.length
    act(() => server.simulateServerClose())

    await user.click(screen.getByRole('button', { name: 'Retry' }))

    expect(FakeWebSocket.instances).toHaveLength(socketCount + 1)
    const retried = FakeWebSocket.latest
    act(() => retried.simulateOpen())
    expect(retried.sent).toEqual([{ type: 'subscribe_lobby' }])
    expect(screen.getByText('Loading games...')).toBeInTheDocument()
    expect(createGameButton()).toBeDisabled()

    receiveGames(retried, [game])

    expect(screen.getByText('Partida 1')).toBeInTheDocument()
    expect(createGameButton()).toBeEnabled()
  })

  it('creates a game on the retried connection', async () => {
    const { server, user } = await reachWaitingScreen()
    act(() => server.simulateServerClose())
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    const retried = FakeWebSocket.latest
    act(() => retried.simulateOpen())
    receiveGames(retried)

    await fillAndSubmitForm(user)

    expect(retried.sent).toMatchObject([
      { type: 'subscribe_lobby' },
      { type: 'create_game' },
    ])
  })

  it('keeps the form open and shows a name_taken error', async () => {
    const { server } = await submitForm()

    receive(server, { type: 'error', field: 'gameName', code: 'name_taken' })

    expect(screen.getByLabelText('Game name')).toHaveValue('Partida 1')
    expect(screen.getByLabelText('Game name')).toHaveAccessibleDescription(
      'That game name is already taken.',
    )
  })
})

// A refresh discards the whole app; only browser storage survives it.
function refresh(app: { unmount: () => void }) {
  app.unmount()
  return renderApp()
}

describe('App after a page refresh', () => {
  it('shows the notice if a game was waiting', async () => {
    refresh(await reachWaitingScreen())

    expect(createGameButton()).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Connection lost, the game was removed',
    )
  })

  it('shows the notice only once', async () => {
    refresh(refresh(await reachWaitingScreen()))

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows no notice if no game was created', async () => {
    refresh(await submitForm())

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows no notice after the game was cancelled', async () => {
    const app = await reachWaitingScreen()
    await app.user.click(screen.getByRole('button', { name: 'Cancel game' }))

    refresh(app)

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows no notice after a lost connection was already reported', async () => {
    const app = await reachWaitingScreen()
    act(() => app.server.simulateServerClose())

    refresh(app)

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

const duel: GameSummary = {
  name: 'Duel',
  maxPlayers: 3,
  boardWidth: 12,
  boardHeight: 10,
  status: 'waiting',
  players: [{ name: 'Esteban', color: 'red' }],
}

function withPlayers(
  base: GameSummary,
  ...players: GameSummary['players']
): GameSummary {
  return { ...base, players: [...base.players, ...players] }
}

const ana = { name: 'Ana', color: 'blue' } as const
const luis = { name: 'Luis', color: 'green' } as const
const duelWithAna = withPlayers(duel, ana)
const fullDuel = withPlayers(duelWithAna, luis)
const startedDuel: GameSummary = { ...fullDuel, status: 'playing' }

const button = (name: string) => screen.getByRole('button', { name })

async function openJoinForm() {
  const app = renderLobby()
  receiveGames(app.server, [duel])
  await app.user.click(button('Join'))
  return app
}

async function submitJoinForm() {
  const app = await openJoinForm()
  await app.user.type(screen.getByLabelText('Your name'), 'Ana')
  await app.user.click(screen.getByRole('radio', { name: 'Blue' }))
  await app.user.click(button('Join'))
  return app
}

const joinFormTitle = () =>
  screen.queryByRole('heading', { name: 'Join Duel' })

describe('App joining a game', () => {
  it('opens the join form without sending anything', async () => {
    const { server } = await openJoinForm()

    expect(joinFormTitle()).toBeInTheDocument()
    expect(server.sent).toEqual([{ type: 'subscribe_lobby' }])
  })

  it('sends join_game over the same socket', async () => {
    const socketCount = () => FakeWebSocket.instances.length
    const { server } = await submitJoinForm()

    expect(server.sent.slice(1)).toEqual([
      { type: 'join_game', gameName: 'Duel', username: 'Ana', color: 'blue' },
    ])
    expect(FakeWebSocket.latest).toBe(server)
    expect(socketCount()).toBeLessThanOrEqual(2)
  })

  it('shows the player waiting room once joined', async () => {
    const { server } = await submitJoinForm()

    receive(server, { type: 'game_joined', game: duelWithAna })
    receiveGames(server, [duelWithAna])

    expect(screen.getByText('Waiting for players...')).toBeInTheDocument()
    expect(
      screen.getAllByRole('button').map((element) => element.textContent),
    ).toEqual(['Leave game'])
    expect(window.sessionStorage.getItem('ugato.waitingGame')).toBe('player')
  })

  it('goes back to the lobby without sending anything', async () => {
    const { server, user } = await openJoinForm()

    await user.click(button('Back'))

    expect(createGameButton()).toBeEnabled()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(server.sent).toEqual([{ type: 'subscribe_lobby' }])
  })
})

const FULL_NOTICE = 'That game is full'
const GONE_NOTICE = 'That game is no longer available'
const STARTED_NOTICE = 'That game has already started'

function expectLobbyWithNotice(notice: string) {
  expect(createGameButton()).toBeInTheDocument()
  expect(screen.getByRole('alert').textContent).toBe(notice)
}

describe('App join form', () => {
  it.each([
    ['starts', [startedDuel], STARTED_NOTICE],
    ['disappears', [], GONE_NOTICE],
  ])('returns to the lobby when the game %s', async (_, games, notice) => {
    const { server } = await openJoinForm()

    receiveGames(server, games)

    expectLobbyWithNotice(notice)
  })

  it('disables a color as soon as the lobby reports it taken', async () => {
    const { server, user } = await openJoinForm()
    await user.click(screen.getByRole('radio', { name: 'Blue' }))

    receiveGames(server, [duelWithAna])

    expect(joinFormTitle()).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Blue' })).toBeDisabled()
    expect(screen.getByRole('radio', { name: 'Blue' })).not.toBeChecked()
  })

  it.each([
    ['game_full', FULL_NOTICE],
    ['game_not_found', GONE_NOTICE],
    ['game_in_progress', STARTED_NOTICE],
  ])('returns to the lobby on a %s error', async (code, notice) => {
    const { server } = await submitJoinForm()

    receive(server, { type: 'error', field: 'gameName', code })

    expectLobbyWithNotice(notice)
  })

  it('stays on the form to show a taken username', async () => {
    const { server } = await submitJoinForm()

    receive(server, {
      type: 'error',
      field: 'username',
      code: 'username_taken',
    })

    expect(joinFormTitle()).toBeInTheDocument()
    expect(screen.getByLabelText('Your name')).toHaveValue('Ana')
    expect(screen.getByLabelText('Your name')).toHaveAccessibleDescription(
      'That name is already used in this game.',
    )
  })

  it('ignores a late join error once the user is back on the lobby', async () => {
    const { server, user } = await submitJoinForm()
    await user.click(button('Back'))

    receive(server, { type: 'error', field: 'color', code: 'color_taken' })

    expect(createGameButton()).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('leaves for the disconnected lobby, with no notice', async () => {
    const { server } = await openJoinForm()

    act(() => server.simulateServerClose())

    expectDisconnectedLobby()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

async function joinDuel() {
  const app = await submitJoinForm()
  receive(app.server, { type: 'game_joined', game: duelWithAna })
  receiveGames(app.server, [duelWithAna])
  return app
}

describe('App waiting room', () => {
  it.each([
    ['host', reachWaitingScreen, withPlayers(game, ana)],
    ['player', joinDuel, fullDuel],
  ])('updates the player list for a %s', async (_, reach, updated) => {
    const { server } = await reach()
    const before = screen.getAllByRole('listitem').length

    receive(server, { type: 'game_updated', game: updated })

    expect(screen.getAllByRole('listitem')).toHaveLength(before + 1)
    expect(
      screen.getByText(`${updated.players.length} / ${updated.maxPlayers}`),
    ).toBeInTheDocument()
  })

  it('ignores a roster update when the user is not waiting', () => {
    const { server } = renderLobby()

    receive(server, { type: 'game_updated', game: duelWithAna })

    expect(createGameButton()).toBeInTheDocument()
  })

  it('leaves the game over the same connection, with no notice', async () => {
    const { server, user } = await joinDuel()
    const socketCount = FakeWebSocket.instances.length

    await user.click(button('Leave game'))

    expect(server.sent.at(-1)).toEqual({ type: 'leave_game' })
    expect(createGameButton()).toBeEnabled()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(server.closed).toBe(false)
    expect(FakeWebSocket.instances).toHaveLength(socketCount)
    expect(window.sessionStorage).toHaveLength(0)
  })

  it('returns to the lobby when the host closes the game', async () => {
    const { server } = await joinDuel()

    receive(server, { type: 'game_closed' })

    expectLobbyWithNotice('The host closed the game')
    expect(createGameButton()).toBeEnabled()
    expect(window.sessionStorage).toHaveLength(0)
  })
})

describe('App lost connection as a player', () => {
  const PLAYER_NOTICE = 'Connection lost, you left the game'

  it('shows that the player left the game', async () => {
    const { server } = await joinDuel()

    act(() => server.simulateServerClose())

    expectDisconnectedLobby()
    expect(screen.getByRole('alert').textContent).toBe(PLAYER_NOTICE)
    expect(window.sessionStorage).toHaveLength(0)
  })

  it('shows the notice once after a page refresh', async () => {
    const refreshed = refresh(await joinDuel())

    expect(screen.getByRole('alert').textContent).toBe(PLAYER_NOTICE)
    refresh(refreshed)

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

const startedGame: GameSummary = {
  ...withPlayers(game, ana),
  status: 'playing',
}

// The host is "Esteban", and "Ana" moves first.
const opening = makeState()

async function startAsHost() {
  const app = await reachWaitingScreen()
  receive(app.server, { type: 'game_updated', game: startedGame })
  receive(app.server, { type: 'game_started', state: opening })
  receiveGames(app.server, [startedGame])
  return app
}

/** Join the last seat of "Duel" as "Ana", which starts it. */
async function startAsPlayer(state = opening) {
  const app = await submitJoinForm()
  const started: GameSummary = { ...duelWithAna, status: 'playing' }
  // Both arrive before React has rendered the waiting room.
  act(() => {
    app.server.simulateMessage({ type: 'game_joined', game: started })
    app.server.simulateMessage({ type: 'game_started', state })
  })
  receiveGames(app.server, [started])
  return app
}

const turnBar = () => screen.getByTestId('turn-bar')

const scoreRows = () =>
  within(screen.getByRole('list', { name: 'Players' }))
    .getAllByRole('listitem')
    .map((row) => row.textContent)

function clickCell(row: number, col: number) {
  const cell = document.querySelector(
    `[data-row="${row}"][data-col="${col}"]`,
  )!
  const mouse = { pointerId: 1, pointerType: 'mouse', button: 0 }
  fireEvent.pointerDown(cell, mouse)
  fireEvent.pointerUp(cell, mouse)
}

describe('App game start', () => {
  it('takes the host from the waiting screen to the game', async () => {
    await startAsHost()

    expect(turnBar()).toHaveTextContent("Ana's turn")
    expect(turnBar()).toHaveTextContent('Ana (Blue)')
    expect(scoreRows()).toEqual(['Ana 0', 'Esteban 0'])
    expect(
      screen.queryByRole('button', { name: 'Cancel game' }),
    ).not.toBeInTheDocument()
  })

  it('takes the player who fills the game straight to it', async () => {
    await startAsPlayer()

    expect(turnBar()).toHaveTextContent('Your turn!')
    expect(button('Leave game')).toBeInTheDocument()
    expect(
      screen.queryByText('Waiting for players...'),
    ).not.toBeInTheDocument()
  })

  it('knows who a player is when others joined first', async () => {
    const app = await joinDuel()
    const started: GameSummary = startedDuel

    receive(app.server, { type: 'game_updated', game: started })
    receive(app.server, {
      type: 'game_started',
      state: makeState({
        turnOrder: ['Ana', 'Esteban', 'Luis'],
        scores: { Ana: 0, Esteban: 0, Luis: 0 },
      }),
    })

    expect(turnBar()).toHaveTextContent('Your turn!')
  })

  it('ignores a start that arrives after the user left', async () => {
    const { server, user } = await joinDuel()
    await user.click(button('Leave game'))

    receive(server, { type: 'game_started', state: opening })

    expect(
      server.sent.filter(
        (message) => (message as { type: string }).type === 'leave_game',
      ),
    ).toHaveLength(1)
    expect(createGameButton()).toBeInTheDocument()
    expect(window.sessionStorage).toHaveLength(0)
  })
})

describe('App moves', () => {
  it('shows each new state', async () => {
    const { server } = await startAsHost()

    receive(server, {
      type: 'game_state',
      state: makeState({
        currentPlayer: 'Esteban',
        scores: { Ana: 1, Esteban: 0 },
      }),
    })

    expect(turnBar()).toHaveTextContent('Your turn!')
    expect(scoreRows()).toEqual(['Ana 1', 'Esteban 0'])
  })

  it('sends the cell the user marks', async () => {
    const { server } = await startAsPlayer()

    clickCell(2, 3)

    expect(server.sent.at(-1)).toEqual({ type: 'mark_cell', row: 2, col: 3 })
  })

  it('sends the U the user confirms', async () => {
    const candidates = [0, 1].map((row) =>
      [0, 1, 2, 3, 4].map((col) => ({ row, col })),
    )
    const { server, user } = await startAsPlayer()
    receive(server, {
      type: 'game_state',
      state: makeState({ phase: 'choose', candidates }),
    })

    await user.click(button('Next'))
    await user.click(button('Confirm'))

    expect(server.sent.at(-1)).toEqual({ type: 'choose_u', index: 1 })
  })
})

const gameOver = {
  type: 'game_over',
  winners: ['Ana'],
  scores: { Ana: 3, Esteban: 1 },
  reason: 'board_full',
  board: opening.board,
}

describe('App end of the game', () => {
  it('shows the winner screen', async () => {
    const { server } = await startAsHost()

    receive(server, gameOver)

    expect(
      screen.getByRole('heading', { name: 'Ana wins!' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Ana 3')).toBeInTheDocument()
    expect(window.sessionStorage).toHaveLength(0)
  })

  it('returns to the current lobby on Close, sending nothing', async () => {
    const { server, user } = await startAsHost()
    receive(server, gameOver)
    receiveGames(server, [duel])
    const sent = server.sent.length

    await user.click(button('Close'))

    expect(screen.getByText('Duel')).toBeInTheDocument()
    expect(createGameButton()).toBeEnabled()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(server.sent).toHaveLength(sent)
    expect(window.sessionStorage).toHaveLength(0)
  })

  it('keeps the winner screen if the connection is then lost', async () => {
    const { server, user } = await startAsHost()
    receive(server, gameOver)

    act(() => server.simulateServerClose())
    expect(
      screen.getByRole('heading', { name: 'Ana wins!' }),
    ).toBeInTheDocument()
    await user.click(button('Close'))

    expectDisconnectedLobby()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('App leaving a game in progress', () => {
  const PLAYING_NOTICE = 'Connection lost, you left the game'

  it.each([
    ['host', startAsHost],
    ['player', startAsPlayer],
  ])('sends leave_game for the %s and shows the lobby', async (_, start) => {
    const { server, user } = await start()

    await user.click(button('Leave game'))

    expect(server.sent.at(-1)).toEqual({ type: 'leave_game' })
    expect(server.sent).not.toContainEqual({ type: 'cancel_game' })
    expect(createGameButton()).toBeEnabled()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(window.sessionStorage).toHaveLength(0)
  })

  it('tells a host who loses the connection that they left', async () => {
    const { server } = await startAsHost()

    act(() => server.simulateServerClose())

    expectDisconnectedLobby()
    expect(screen.getByRole('alert').textContent).toBe(PLAYING_NOTICE)
    expect(window.sessionStorage).toHaveLength(0)
  })

  it('shows the notice once after a refresh', async () => {
    const refreshed = refresh(await startAsHost())

    expect(screen.getByRole('alert').textContent).toBe(PLAYING_NOTICE)
    refresh(refreshed)

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

// The server may start the game before it reads the host's cancel_game, which it
// then ignores. The host would stay seated in a game they cannot see.
describe('App cancelling as the game starts', () => {
  const sentOfType = (server: FakeWebSocket, type: string) =>
    server.sent.filter((message) => (message as { type: string }).type === type)

  async function cancelAsHost() {
    const app = await reachWaitingScreen()
    await app.user.click(button('Cancel game'))
    return app
  }

  it('leaves the game that started anyway', async () => {
    const { server } = await cancelAsHost()

    receive(server, { type: 'game_started', state: opening })

    expect(server.sent.slice(-2)).toEqual([
      { type: 'cancel_game' },
      { type: 'leave_game' },
    ])
    expect(createGameButton()).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(window.sessionStorage).toHaveLength(0)
  })

  it('leaves it only once', async () => {
    const { server } = await cancelAsHost()

    receive(server, { type: 'game_started', state: opening })
    receive(server, { type: 'game_started', state: opening })

    expect(sentOfType(server, 'leave_game')).toHaveLength(1)
  })

  it('does not leave the next game the user is in', async () => {
    const { server, user } = await cancelAsHost()
    receiveGames(server, [duel])
    await user.click(button('Join'))
    await user.type(screen.getByLabelText('Your name'), 'Ana')
    await user.click(screen.getByRole('radio', { name: 'Blue' }))
    await user.click(button('Join'))

    receive(server, { type: 'game_joined', game: duelWithAna })
    receive(server, { type: 'game_started', state: opening })

    expect(sentOfType(server, 'leave_game')).toEqual([])
    expect(turnBar()).toBeInTheDocument()
  })
})
