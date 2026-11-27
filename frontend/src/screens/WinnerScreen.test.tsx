import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { GameOver, Player } from '../game/types'
import { emptyBoard } from '../test/gameState'
import { WinnerScreen } from './WinnerScreen'

const gameOver: GameOver = {
  winners: ['Esteban'],
  scores: { Ana: 2, Esteban: 4, Luis: 0 },
  reason: 'board_full',
  board: emptyBoard(12, 10),
}

const players: Player[] = [
  { name: 'Esteban', color: 'red' },
  { name: 'Ana', color: 'blue' },
  { name: 'Luis', color: 'green' },
]

function renderWinner(overrides: Partial<GameOver> = {}) {
  const onClose = vi.fn()
  render(
    <WinnerScreen
      gameOver={{ ...gameOver, ...overrides }}
      players={players}
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

  it("gives each final score a swatch in the player's color", () => {
    renderWinner()

    const swatches = within(
      screen.getByRole('list', { name: 'Final scores' }),
    )
      .getAllByRole('listitem')
      .map((item) => item.querySelector('.swatch')?.className)

    // Best first: Esteban, Ana, Luis.
    expect(swatches).toEqual([
      'swatch color-red',
      'swatch color-blue',
      'swatch color-green',
    ])
  })

  it('styles the close button as a primary button', () => {
    renderWinner()

    expect(screen.getByRole('button', { name: 'Close' })).toHaveClass('btn')
  })

  it('closes', async () => {
    const { onClose } = renderWinner()

    await userEvent.click(screen.getByRole('button', { name: 'Close' }))

    expect(onClose).toHaveBeenCalledOnce()
  })
})
