import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { GameSummary } from '../game/types'
import { WaitingScreen } from './WaitingScreen'

const game: GameSummary = {
  name: 'Partida 1',
  maxPlayers: 2,
  boardWidth: 12,
  boardHeight: 10,
  players: [{ name: 'Esteban', color: 'red' }],
}

describe('WaitingScreen', () => {
  it('shows the game summary', () => {
    render(<WaitingScreen game={game} onCancel={vi.fn()} />)

    for (const text of [
      'Waiting for players...',
      'Partida 1',
      'Esteban (Red)',
      '1 / 2',
      '12 x 10',
    ]) {
      expect(screen.getByText(text)).toBeInTheDocument()
    }
  })

  it('offers cancelling as its only action', async () => {
    const onCancel = vi.fn()
    render(<WaitingScreen game={game} onCancel={onCancel} />)

    expect(screen.getAllByRole('button')).toHaveLength(1)
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Cancel game' }))

    expect(onCancel).toHaveBeenCalledOnce()
  })
})
