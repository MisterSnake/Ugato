import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { CreateGameForm } from './CreateGameForm'

function renderForm() {
  const onSubmit = vi.fn()
  render(<CreateGameForm onSubmit={onSubmit} />)
  return { onSubmit }
}

describe('CreateGameForm fields', () => {
  it('has empty name and game name fields', () => {
    renderForm()

    expect(screen.getByLabelText('Your name')).toHaveValue('')
    expect(screen.getByLabelText('Game name')).toHaveValue('')
  })

  it('offers the six colors with none preselected', () => {
    renderForm()

    const colors = within(
      screen.getByRole('group', { name: 'Color' }),
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

  it('defaults to 2 max players and an 8 x 8 board', () => {
    renderForm()

    expect(screen.getByLabelText('Max players')).toHaveValue('2')
    expect(screen.getByLabelText('Board width')).toHaveValue(8)
    expect(screen.getByLabelText('Board height')).toHaveValue(8)
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

    await user.selectOptions(screen.getByLabelText('Max players'), '3')
    await user.click(submitButton())

    expect(onSubmit).toHaveBeenCalledExactlyOnceWith({
      username: 'Esteban',
      color: 'red',
      gameName: 'Partida 1',
      maxPlayers: 3,
      boardWidth: 12,
      boardHeight: 10,
    })
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
      screen.getByRole('group', { name: 'Color' }),
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
