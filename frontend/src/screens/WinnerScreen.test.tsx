import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { GameOver } from '../game/types'
import { emptyBoard } from '../test/gameState'
import { WinnerScreen } from './WinnerScreen'

const gameOver: GameOver = {
  winners: ['Esteban'],
  scores: { Ana: 2, Esteban: 4, Luis: 0 },
  reason: 'board_full',
  board: emptyBoard(12, 10),
}

function renderWinner(overrides: Partial<GameOver> = {}) {
  const onClose = vi.fn()
  render(
    <WinnerScreen
      gameOver={{ ...gameOver, ...overrides }}
      me="Ana"
      onClose={onClose}
    />,
  )
  return { onClose }
}

describe('WinnerScreen', () => {
  it('names the winner and lists every final score, best first', () => {
    renderWinner()

    expect(
      screen.getByRole('heading', { name: 'Esteban wins!' }),
    ).toBeInTheDocument()
    const scores = within(
      screen.getByRole('list', { name: 'Final scores' }),
    ).getAllByRole('listitem')
    expect(scores.map((item) => item.textContent)).toEqual([
      'Esteban 4',
      'Ana 2',
      'Luis 0',
    ])
    expect(screen.queryByText('Everyone else left.')).not.toBeInTheDocument()
  })

  it('says that everyone else left', () => {
    renderWinner({ winners: ['Ana'], reason: 'last_player' })

    expect(
      screen.getByRole('heading', { name: 'You win!' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Everyone else left.')).toBeInTheDocument()
  })

  it('says that the players voted to end the game', () => {
    renderWinner({ reason: 'vote' })

    expect(
      screen.getByRole('heading', { name: 'Esteban wins!' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText('The players voted to end the game.'),
    ).toBeInTheDocument()
    expect(
      within(screen.getByRole('list', { name: 'Final scores' })).getAllByRole(
        'listitem',
      ),
    ).toHaveLength(3)
  })

  it('announces a draw', () => {
    renderWinner({ winners: ['Esteban', 'Ana'] })

    expect(
      screen.getByRole('heading', { name: 'Draw between Esteban and Ana' }),
    ).toBeInTheDocument()
  })

  it('closes', async () => {
    const { onClose } = renderWinner()

    await userEvent.click(screen.getByRole('button', { name: 'Close' }))

    expect(onClose).toHaveBeenCalledOnce()
  })
})
