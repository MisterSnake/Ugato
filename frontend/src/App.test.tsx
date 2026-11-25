import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StrictMode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { createGameSocket } from './game/gameSocket'
import type { GameSocketFactory } from './game/gameSocket'
import type { GameSummary } from './game/types'
import { FakeWebSocket } from './test/FakeWebSocket'

const game: GameSummary = {
  name: 'Partida 1',
  maxPlayers: 2,
  boardWidth: 12,
  boardHeight: 10,
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
