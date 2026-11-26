import { useState } from 'react'
import {
  BOARD_MAX_SIZE,
  BOARD_MIN_SIZE,
  MAX_PLAYERS,
  MIN_PLAYERS,
  validateDraft,
} from '../game/validation'
import type {
  CreateGameRequest,
  ErrorField,
  ServerError,
} from '../game/types'
import { ColorField } from './ColorField'
import { ErrorMessage } from './ErrorMessage'
import { useFieldErrors } from './useFieldErrors'

interface CreateGameFormProps {
  onSubmit: (request: CreateGameRequest) => void
  serverError?: ServerError
}

const PLAYER_OPTIONS = Array.from(
  { length: MAX_PLAYERS - MIN_PLAYERS + 1 },
  (_, index) => MIN_PLAYERS + index,
)

export function CreateGameForm({
  onSubmit,
  serverError,
}: CreateGameFormProps) {
  // Inputs keep their raw text, so a number field can be left empty while typing.
  const [values, setValues] = useState({
    username: '',
    color: '',
    gameName: '',
    maxPlayers: String(MIN_PLAYERS),
    boardWidth: String(BOARD_MIN_SIZE),
    boardHeight: String(BOARD_MIN_SIZE),
  })

  const result = validateDraft({
    ...values,
    maxPlayers: Number(values.maxPlayers),
    boardWidth: Number(values.boardWidth),
    boardHeight: Number(values.boardHeight),
  })

  const errors = useFieldErrors(
    'errors' in result ? result.errors : {},
    serverError,
  )
  const { errorProps } = errors

  function setValue(name: keyof typeof values, value: string) {
    setValues((current) => ({ ...current, [name]: value }))
    const field =
      name === 'boardWidth' || name === 'boardHeight' ? 'board' : name
    errors.edit(field)
  }

  function errorMessage(field: ErrorField) {
    return <ErrorMessage id={`${field}-error`} code={errors.errorFor(field)} />
  }

  function handleSubmit(event: { preventDefault(): void }) {
    event.preventDefault()
    errors.markSubmitted()
    if ('request' in result) onSubmit(result.request)
  }

  return (
    <main className="screen">
      <h1>Create game</h1>
      <form noValidate onSubmit={handleSubmit}>
        <div className="field">
          <label htmlFor="username">Your name</label>
          <input
            id="username"
            value={values.username}
            onChange={(event) => setValue('username', event.target.value)}
            onBlur={() => errors.touch('username')}
            {...errorProps('username')}
          />
          {errorMessage('username')}
        </div>

        <ColorField
          value={values.color}
          error={errors.errorFor('color')}
          onChange={(color) => setValue('color', color)}
        />

        <div className="field">
          <label htmlFor="gameName">Game name</label>
          <input
            id="gameName"
            value={values.gameName}
            onChange={(event) => setValue('gameName', event.target.value)}
            onBlur={() => errors.touch('gameName')}
            {...errorProps('gameName')}
          />
          {errorMessage('gameName')}
        </div>

        <div className="field">
          <label htmlFor="maxPlayers">Max players</label>
          <select
            id="maxPlayers"
            value={values.maxPlayers}
            onChange={(event) => setValue('maxPlayers', event.target.value)}
            {...errorProps('maxPlayers')}
          >
            {PLAYER_OPTIONS.map((count) => (
              <option key={count} value={count}>
                {count}
              </option>
            ))}
          </select>
          {errorMessage('maxPlayers')}
        </div>

        <fieldset
          className="field"
          aria-describedby={errorProps('board')['aria-describedby']}
        >
          <legend>Board size</legend>
          {(['boardWidth', 'boardHeight'] as const).map((name) => (
            <div key={name}>
              <label htmlFor={name}>
                {name === 'boardWidth' ? 'Board width' : 'Board height'}
              </label>
              <input
                id={name}
                type="number"
                min={BOARD_MIN_SIZE}
                max={BOARD_MAX_SIZE}
                value={values[name]}
                onChange={(event) => setValue(name, event.target.value)}
                onBlur={() => errors.touch('board')}
                aria-invalid={errorProps('board')['aria-invalid']}
              />
            </div>
          ))}
          {errorMessage('board')}
        </fieldset>

        <ErrorMessage code={errors.formError} />

        <button type="submit">Create</button>
      </form>
    </main>
  )
}
