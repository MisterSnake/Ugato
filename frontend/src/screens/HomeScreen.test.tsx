import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { LobbyState } from '../game/types'
import { HomeScreen } from './HomeScreen'

const emptyLobby: LobbyState = { status: 'ready', games: [] }

function renderHome(
  overrides: Partial<ComponentProps<typeof HomeScreen>> = {},
) {
  const props = {
    lobby: emptyLobby,
    onCreateGame: vi.fn(),
    onRetry: vi.fn(),
    ...overrides,
  }
  render(<HomeScreen {...props} />)
  return props
}

const twoGames: LobbyState = {
  status: 'ready',
  games: [
    {
      name: 'Partida 1',
      maxPlayers: 2,
      boardWidth: 12,
      boardHeight: 10,
      players: [{ name: 'Esteban', color: 'red' }],
    },
    {
      name: 'Duel',
      maxPlayers: 4,
      boardWidth: 20,
      boardHeight: 15,
      players: [{ name: 'Ana', color: 'blue' }],
    },
  ],
}

const createGameButton = () =>
  screen.getByRole('button', { name: 'Create game' })

describe('HomeScreen', () => {
  it('offers to create a game', async () => {
    const { onCreateGame } = renderHome()

    await userEvent.click(createGameButton())

    expect(onCreateGame).toHaveBeenCalledOnce()
  })

  it('shows no notice by default', () => {
    renderHome()

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows the notice it receives', () => {
    renderHome({ notice: 'Something happened' })

    expect(screen.getByRole('alert')).toHaveTextContent('Something happened')
  })

  it('shows that games are loading while connecting', () => {
    renderHome({ lobby: { status: 'connecting', games: [] } })

    expect(screen.getByText('Loading games...')).toBeInTheDocument()
    expect(createGameButton()).toBeDisabled()
  })

  it('says so when there are no games', () => {
    renderHome()

    expect(screen.getByText('No games yet. Create one!')).toBeInTheDocument()
    expect(createGameButton()).toBeEnabled()
    expect(screen.queryByText('Loading games...')).not.toBeInTheDocument()
  })

  it('offers to retry when disconnected', async () => {
    const { onRetry } = renderHome({
      lobby: { status: 'disconnected', games: [] },
    })

    expect(screen.getByText("Can't reach the server.")).toBeInTheDocument()
    expect(createGameButton()).toBeDisabled()
    expect(
      screen.queryByText('No games yet. Create one!'),
    ).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))

    expect(onRetry).toHaveBeenCalledOnce()
  })

  it('puts "Create game" above the "Open games" list', () => {
    renderHome({ lobby: twoGames })

    const heading = screen.getByRole('heading', { name: 'Open games' })

    expect(createGameButton().compareDocumentPosition(heading)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    )
  })

  it('lists each game in the given order', () => {
    renderHome({ lobby: twoGames })

    const [first, second, ...rest] = screen.getAllByRole('listitem')

    expect(rest).toEqual([])
    for (const text of ['Partida 1', 'Esteban (Red)', '1 / 2', '12 x 10']) {
      expect(within(first).getByText(text)).toBeInTheDocument()
    }
    for (const text of ['Duel', 'Ana (Blue)', '1 / 4', '20 x 15']) {
      expect(within(second).getByText(text)).toBeInTheDocument()
    }
    expect(
      screen.queryByText('No games yet. Create one!'),
    ).not.toBeInTheDocument()
  })

  it('shows rows that do nothing when clicked', async () => {
    const { onCreateGame, onRetry } = renderHome({ lobby: twoGames })
    const before = document.body.innerHTML

    await userEvent.click(screen.getByText('Partida 1'))

    const [row] = screen.getAllByRole('listitem')
    expect(within(row).queryByRole('button')).not.toBeInTheDocument()
    expect(within(row).queryByRole('link')).not.toBeInTheDocument()
    expect(onCreateGame).not.toHaveBeenCalled()
    expect(onRetry).not.toHaveBeenCalled()
    expect(document.body.innerHTML).toBe(before)
  })
})
