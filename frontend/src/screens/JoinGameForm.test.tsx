import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { GameSummary } from '../game/types'
import { JoinGameForm } from './JoinGameForm'

const game: GameSummary = {
  name: 'Partida 1',
  maxPlayers: 4,
  boardWidth: 12,
  boardHeight: 10,
  timer: 'none',
  status: 'waiting',
  players: [{ name: 'Esteban', color: 'red' }],
}

function renderForm(
  overrides: Partial<ComponentProps<typeof JoinGameForm>> = {},
) {
  const props = { game, onSubmit: vi.fn(), onBack: vi.fn(), ...overrides }
  const view = render(<JoinGameForm {...props} />)
  return {
    ...props,
    user: userEvent.setup(),
    rerender: (next: GameSummary) =>
      view.rerender(<JoinGameForm {...props} game={next} />),
  }
}

const nameField = () => screen.getByLabelText('Your name')
const color = (name: string) => screen.getByRole('radio', { name })
const colorGroup = () => screen.getByRole('group', { name: 'Color' })
const joinButton = () => screen.getByRole('button', { name: 'Join' })

describe('JoinGameForm', () => {
  it('names the game and disables the colors used in it', () => {
    renderForm()

    expect(
      screen.getByRole('heading', { name: 'Join Partida 1' }),
    ).toBeInTheDocument()
    expect(color('Red')).toBeDisabled()
    for (const name of ['Blue', 'Yellow', 'Green', 'Orange', 'Purple']) {
      expect(color(name)).toBeEnabled()
    }
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows a name error and does not submit a short name', async () => {
    const { user, onSubmit } = renderForm()

    await user.type(nameField(), 'Al')
    await user.click(color('Blue'))
    await user.click(joinButton())

    expect(nameField()).toHaveAccessibleDescription(/name must be 3-20/i)
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('does not submit without a color', async () => {
    const { user, onSubmit } = renderForm()

    await user.type(nameField(), 'Ana')
    await user.click(joinButton())

    expect(colorGroup()).toHaveAccessibleDescription('Choose a color.')
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('submits the request for this game', async () => {
    const { user, onSubmit } = renderForm()

    await user.type(nameField(), ' Ana ')
    await user.click(color('Blue'))
    await user.click(joinButton())

    expect(onSubmit).toHaveBeenCalledExactlyOnceWith({
      gameName: 'Partida 1',
      username: 'Ana',
      color: 'blue',
    })
  })

  it('goes back', async () => {
    const { user, onBack, onSubmit } = renderForm()

    await user.click(screen.getByRole('button', { name: 'Back' }))

    expect(onBack).toHaveBeenCalledOnce()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('shows a taken username on the name field until it is edited', async () => {
    const { user } = renderForm({
      serverError: { field: 'username', code: 'username_taken' },
    })

    expect(nameField()).toHaveAccessibleDescription(
      'That name is already used in this game.',
    )
    await user.type(nameField(), 'x')

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows a taken color on the color field', () => {
    renderForm({ serverError: { field: 'color', code: 'color_taken' } })

    expect(colorGroup()).toHaveAccessibleDescription(
      'That color is already used in this game.',
    )
    expect(nameField()).toBeValid()
  })

  it('shows an error that has no field as a form message', () => {
    renderForm({ serverError: { code: 'already_in_game' } })

    expect(screen.getByRole('alert')).toHaveTextContent(
      'You already have a game.',
    )
  })

  it('unselects a color that is taken meanwhile', async () => {
    const { user, onSubmit, rerender } = renderForm()
    await user.type(nameField(), 'Ana')
    await user.click(color('Blue'))

    rerender({
      ...game,
      players: [...game.players, { name: 'Luis', color: 'blue' }],
    })

    expect(color('Blue')).toBeDisabled()
    for (const radio of screen.getAllByRole('radio')) {
      expect(radio).not.toBeChecked()
    }
    await user.click(joinButton())
    expect(onSubmit).not.toHaveBeenCalled()
  })
})
