import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { CreateGameForm } from './CreateGameForm'

function renderForm() {
  const onSubmit = vi.fn()
  render(<CreateGameForm onSubmit={onSubmit} />)
  return { onSubmit }
}

const maxPlayers = () => screen.getByRole('group', { name: 'Max players' })

describe('CreateGameForm fields', () => {
  it('has empty name and game name fields', () => {
    renderForm()

    expect(screen.getByLabelText('Your name')).toHaveValue('')
    expect(screen.getByLabelText('Game name')).toHaveValue('')
  })

  it('offers the six colors with none preselected', () => {
    renderForm()

    const colors = within(
      screen.getByRole('group', { name: 'Choose your color' }),
    ).getAllByRole('radio')

    expect(colors.map((radio) => radio.closest('label')?.textContent)).toEqual([
      'Red',
      'Blue',
      'Yellow',
      'Green',
      'Orange',
      'Purple',
    ])
    for (const radio of colors) expect(radio).not.toBeChecked()
  })

  it('gives each color radio a swatch of that color', () => {
    renderForm()

    for (const name of ['Red', 'Blue', 'Yellow', 'Green', 'Orange', 'Purple']) {
      expect(screen.getByRole('radio', { name }).closest('label')).toHaveClass(
        'color-option',
        `color-${name.toLowerCase()}`,
      )
    }
  })

  it('defaults to 2 max players and an 8 x 8 board', () => {
    renderForm()

    expect(within(maxPlayers()).getByRole('radio', { name: '2' })).toBeChecked()
    expect(screen.getByLabelText('Board width')).toHaveValue(8)
    expect(screen.getByLabelText('Board height')).toHaveValue(8)
  })

  it('offers from 2 to 5 max players as radios', () => {
    renderForm()

    const radios = within(maxPlayers()).getAllByRole('radio')

    expect(radios.map((radio) => radio.closest('label')?.textContent)).toEqual([
      '2',
      '3',
      '4',
      '5',
    ])
  })

  it('offers the four timers with "No timer" preselected', () => {
    renderForm()
    const timer = screen.getByLabelText('Timer')

    expect(timer).toHaveDisplayValue('No timer')
    expect(
      within(timer)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['No timer', 'Slow 60-15', 'Normal 30-10', 'Fast 10-5'])
  })
})

async function fillForm({ width = '12', height = '10' } = {}) {
  const user = userEvent.setup()
  await user.type(screen.getByLabelText('Your name'), '  Esteban ')
  await user.click(screen.getByRole('radio', { name: 'Red' }))
  await user.type(screen.getByLabelText('Game name'), 'Partida 1')
  await user.clear(screen.getByLabelText('Board width'))
  await user.type(screen.getByLabelText('Board width'), width)
  await user.clear(screen.getByLabelText('Board height'))
  await user.type(screen.getByLabelText('Board height'), height)
  await user.tab()
  return user
}

const submitButton = () => screen.getByRole('button', { name: 'Create' })

describe('CreateGameForm validation', () => {
  it('submits a typed request when the input is valid', async () => {
    const { onSubmit } = renderForm()
    const user = await fillForm()

    await user.click(within(maxPlayers()).getByRole('radio', { name: '3' }))
    await user.click(submitButton())

    expect(onSubmit).toHaveBeenCalledExactlyOnceWith({
      username: 'Esteban',
      color: 'red',
      gameName: 'Partida 1',
      maxPlayers: 3,
      boardWidth: 12,
      boardHeight: 10,
      timer: 'none',
    })
  })

  it('submits a board size set with the step buttons', async () => {
    const { onSubmit } = renderForm()
    const user = await fillForm({ width: '12', height: '8' })
    const taller = screen.getByRole('button', {
      name: 'Increase board height',
    })

    await user.click(taller)
    await user.click(taller)
    await user.click(submitButton())

    expect(onSubmit).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ boardHeight: 10 }),
    )
  })

  it('shows the board error for a typed value out of range', async () => {
    const { onSubmit } = renderForm()
    const user = await fillForm({ width: '31' })
    await user.click(submitButton())

    expect(
      screen.getByRole('group', { name: 'Board size' }),
    ).toHaveAccessibleDescription(/must be 8-30/i)
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('submits the chosen timer', async () => {
    const { onSubmit } = renderForm()
    const user = await fillForm()

    await user.selectOptions(screen.getByLabelText('Timer'), 'Fast 10-5')
    await user.click(submitButton())

    expect(onSubmit).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ timer: 'fast' }),
    )
  })

  it('shows a board error and does not submit when height exceeds width', async () => {
    const { onSubmit } = renderForm()
    const user = await fillForm({ width: '8', height: '12' })
    const board = screen.getByRole('group', { name: 'Board size' })

    expect(board).toHaveAccessibleDescription(/height cannot exceed width/i)
    await user.click(submitButton())

    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('shows no errors before the user interacts', () => {
    renderForm()

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows every field error when an empty form is submitted', async () => {
    const { onSubmit } = renderForm()

    await userEvent.click(submitButton())

    expect(screen.getByLabelText('Your name')).toHaveAccessibleDescription(
      /name must be 3-20/i,
    )
    expect(
      screen.getByRole('group', { name: 'Choose your color' }),
    ).toHaveAccessibleDescription('Choose a color.')
    expect(screen.getByLabelText('Game name')).toHaveAccessibleDescription(
      /game name must be 3-20/i,
    )
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('clears an error once the field is fixed', async () => {
    renderForm()
    const user = userEvent.setup()
    const name = screen.getByLabelText('Your name')

    await user.type(name, 'Al')
    await user.tab()
    expect(name).toBeInvalid()

    await user.type(name, 'ex')

    expect(name).toBeValid()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('CreateGameForm server errors', () => {
  const nameTaken = { field: 'gameName', code: 'name_taken' } as const

  it('shows the error on the matching field', () => {
    render(<CreateGameForm onSubmit={vi.fn()} serverError={nameTaken} />)

    expect(screen.getByLabelText('Game name')).toHaveAccessibleDescription(
      'That game name is already taken.',
    )
    expect(screen.getByLabelText('Game name')).toBeInvalid()
    expect(screen.getByLabelText('Your name')).toBeValid()
  })

  it('hides the error once that field is edited', async () => {
    render(<CreateGameForm onSubmit={vi.fn()} serverError={nameTaken} />)

    await userEvent.type(screen.getByLabelText('Game name'), 'x')

    expect(
      screen.queryByText('That game name is already taken.'),
    ).not.toBeInTheDocument()
  })

  it('shows a timer error on the timer field until it is changed', async () => {
    render(
      <CreateGameForm
        onSubmit={vi.fn()}
        serverError={{ field: 'timer', code: 'invalid_timer' }}
      />,
    )
    const timer = screen.getByLabelText('Timer')

    expect(timer).toHaveAccessibleDescription('Choose a timer.')
    expect(timer).toBeInvalid()

    await userEvent.selectOptions(timer, 'Slow 60-15')

    expect(timer).toBeValid()
  })

  it('shows a max players error on its group until another count is chosen', async () => {
    render(
      <CreateGameForm
        onSubmit={vi.fn()}
        serverError={{ field: 'maxPlayers', code: 'invalid_max_players' }}
      />,
    )

    expect(maxPlayers()).toHaveAccessibleDescription(
      'Max players must be between 2 and 5.',
    )

    await userEvent.click(screen.getByRole('radio', { name: '4' }))

    expect(maxPlayers()).not.toHaveAccessibleDescription()
  })

  it('shows an error that has no field as a form message', () => {
    render(
      <CreateGameForm
        onSubmit={vi.fn()}
        serverError={{ code: 'already_in_game' }}
      />,
    )

    expect(screen.getByRole('alert')).toHaveTextContent(
      'You already have a game.',
    )
  })
})
