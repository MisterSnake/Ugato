import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { HomeScreen } from './HomeScreen'

describe('HomeScreen', () => {
  it('offers to create a game', async () => {
    const onCreateGame = vi.fn()
    render(<HomeScreen onCreateGame={onCreateGame} />)

    await userEvent.click(screen.getByRole('button', { name: 'Create game' }))

    expect(onCreateGame).toHaveBeenCalledOnce()
  })

  it('shows no notice by default', () => {
    render(<HomeScreen onCreateGame={vi.fn()} />)

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows the notice it receives', () => {
    render(<HomeScreen onCreateGame={vi.fn()} notice="Something happened" />)

    expect(screen.getByRole('alert')).toHaveTextContent('Something happened')
  })
})
