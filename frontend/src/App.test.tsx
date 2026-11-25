import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StrictMode } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
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

async function submitForm() {
  const app = renderApp()
  const { user } = app
  await user.click(screen.getByRole('button', { name: 'Create game' }))
  await user.type(screen.getByLabelText('Your name'), 'Esteban')
  await user.click(screen.getByRole('radio', { name: 'Red' }))
  await user.type(screen.getByLabelText('Game name'), 'Partida 1')
  await user.clear(screen.getByLabelText('Board width'))
  await user.type(screen.getByLabelText('Board width'), '12')
  await user.clear(screen.getByLabelText('Board height'))
  await user.type(screen.getByLabelText('Board height'), '10')
  await user.click(screen.getByRole('button', { name: 'Create' }))
  return { ...app, server: FakeWebSocket.latest }
}

function receive(server: FakeWebSocket, message: object) {
  act(() => server.simulateMessage(message))
}

beforeEach(() => {
  FakeWebSocket.instances = []
  window.sessionStorage.clear()
})

describe('App flow', () => {
  it('opens no socket until the form is submitted', async () => {
    const { user } = renderApp()

    await user.click(screen.getByRole('button', { name: 'Create game' }))

    expect(screen.getByLabelText('Your name')).toBeInTheDocument()
    expect(FakeWebSocket.instances).toHaveLength(0)
  })

  it('sends the form data over a socket to /api/ws', async () => {
    const { server } = await submitForm()

    act(() => server.simulateOpen())

    expect(server.url).toBe(`ws://${window.location.host}/api/ws`)
    expect(server.sent).toEqual([
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
    act(() => server.simulateOpen())
    receive(server, { type: 'error', field: 'gameName', code: 'name_taken' })

    await user.type(screen.getByLabelText('Game name'), '2')
    await user.click(screen.getByRole('button', { name: 'Create' }))

    expect(FakeWebSocket.instances).toHaveLength(1)
    expect(server.sent).toHaveLength(2)
  })

  it('closes the socket when it unmounts', async () => {
    const { server, unmount } = await submitForm()

    unmount()

    expect(server.closed).toBe(true)
  })
})

async function reachWaitingScreen() {
  const app = await submitForm()
  act(() => app.server.simulateOpen())
  receive(app.server, { type: 'game_created', game })
  return app
}

const createGameButton = () =>
  screen.getByRole('button', { name: 'Create game' })

describe('App cancel and lost connection', () => {
  it('cancels the game and returns home with no notice', async () => {
    const { server, user } = await reachWaitingScreen()

    await user.click(screen.getByRole('button', { name: 'Cancel game' }))

    expect(server.sent.at(-1)).toEqual({ type: 'cancel_game' })
    expect(server.closed).toBe(true)
    expect(createGameButton()).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('returns home with a notice when the connection is lost', async () => {
    const { server } = await reachWaitingScreen()

    act(() => server.simulateServerClose())

    expect(createGameButton()).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Connection lost, the game was removed',
    )
  })

  it('keeps the form open and shows a name_taken error', async () => {
    const { server } = await submitForm()
    act(() => server.simulateOpen())

    receive(server, { type: 'error', field: 'gameName', code: 'name_taken' })

    expect(screen.getByLabelText('Game name')).toHaveValue('Partida 1')
    expect(screen.getByLabelText('Game name')).toHaveAccessibleDescription(
      'That game name is already taken.',
    )
  })

  it.each([
    ['cancelling', 'Cancel game'],
    ['losing the connection', undefined],
  ])('opens a new socket for the next game after %s', async (_, button) => {
    const { server, user } = await reachWaitingScreen()
    if (button) await user.click(screen.getByRole('button', { name: button }))
    else act(() => server.simulateServerClose())

    await user.click(createGameButton())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    await user.type(screen.getByLabelText('Your name'), 'Esteban')
    await user.click(screen.getByRole('radio', { name: 'Red' }))
    await user.type(screen.getByLabelText('Game name'), 'Partida 1')
    await user.click(screen.getByRole('button', { name: 'Create' }))

    expect(FakeWebSocket.instances).toHaveLength(2)
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
