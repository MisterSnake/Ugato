import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { GameSummary } from '../game/types'
import { WaitingScreen } from './WaitingScreen'

const game: GameSummary = {
  name: 'Partida 1',
  maxPlayers: 3,
  boardWidth: 12,
  boardHeight: 10,
  timer: 'none',
  status: 'waiting',
  players: [
    { name: 'Esteban', color: 'red' },
    { name: 'Ana', color: 'blue' },
  ],
}

function renderWaiting(
  overrides: Partial<ComponentProps<typeof WaitingScreen>> = {},
) {
  const props = {
    game,
    role: 'host' as const,
    onLeave: vi.fn(),
    ...overrides,
  }
  const view = render(<WaitingScreen {...props} />)
  return {
    ...props,
    rerender: (next: GameSummary) =>
      view.rerender(<WaitingScreen {...props} game={next} />),
  }
}

const listedPlayers = () =>
  within(screen.getByRole('list', { name: 'Players' }))
    .getAllByRole('listitem')
    .map((item) => item.textContent)

describe('WaitingScreen', () => {
  it('shows the game summary', () => {
    renderWaiting()

    for (const text of [
      'Waiting for players...',
      'Partida 1',
      'Esteban (host)',
      'Ana',
      '2 / 3',
      '12 x 10',
    ]) {
      expect(screen.getByText(text)).toBeInTheDocument()
    }
  })

  it.each([
    ['host', 'normal', 'Normal 30-10'],
    ['player', 'slow', 'Slow 60-15'],
    ['player', 'none', 'No timer'],
  ] as const)('shows a %s the %s timer', (role, timer, label) => {
    renderWaiting({ role, game: { ...game, timer } })

    expect(screen.getByText(label)).toBeInTheDocument()
  })

  it('lists the players with their colors in join order', () => {
    renderWaiting()

    expect(listedPlayers()).toEqual(['Esteban (host) Red', 'Ana Blue'])
  })

  it.each([
    ['host', 'Cancel game'],
    ['player', 'Leave game'],
  ] as const)('offers a %s "%s" as the only action', async (role, label) => {
    const { onLeave } = renderWaiting({ role })

    expect(screen.getAllByRole('button')).toHaveLength(1)
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: label }))

    expect(onLeave).toHaveBeenCalledOnce()
  })

  it('updates the list and the count with a new game', () => {
    const { rerender } = renderWaiting()

    rerender({
      ...game,
      players: [...game.players, { name: 'Luis', color: 'green' }],
    })

    expect(listedPlayers()).toEqual([
      'Esteban (host) Red',
      'Ana Blue',
      'Luis Green',
    ])
    expect(screen.getByText('3 / 3')).toBeInTheDocument()
  })
})
