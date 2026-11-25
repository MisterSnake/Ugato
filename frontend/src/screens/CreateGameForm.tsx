import { useState } from 'react'
import {
  BOARD_MAX_SIZE,
  BOARD_MIN_SIZE,
  MAX_PLAYERS,
  MIN_PLAYERS,
  validateDraft,
} from '../game/validation'
import { COLORS } from '../game/types'
import type {
  CreateGameRequest,
  ErrorField,
  ServerError,
} from '../game/types'
import { colorLabel } from './colorLabel'
import { ERROR_MESSAGES } from './errorMessages'

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

  const [touched, setTouched] = useState<Partial<Record<ErrorField, boolean>>>(
    {},
  )
  const [submitted, setSubmitted] = useState(false)
  // The server error stops applying once the user edits the field it is about.
  const [outdatedError, setOutdatedError] = useState<ServerError>()
  const activeServerError =
    serverError === outdatedError ? undefined : serverError

  function setValue(name: keyof typeof values, value: string) {
    setValues((current) => ({ ...current, [name]: value }))
    const field =
      name === 'boardWidth' || name === 'boardHeight' ? 'board' : name
    if (serverError?.field === field) setOutdatedError(serverError)
  }

  function touch(field: ErrorField) {
    setTouched((current) => ({ ...current, [field]: true }))
  }

  const result = validateDraft({
    ...values,
    maxPlayers: Number(values.maxPlayers),
    boardWidth: Number(values.boardWidth),
    boardHeight: Number(values.boardHeight),
  })

  // A field shows its client error once the user has left it or tried to submit.
  function errorFor(field: ErrorField) {
    const clientError =
      'errors' in result && (submitted || touched[field])
        ? result.errors[field]
        : undefined
    if (clientError) return clientError
    return activeServerError?.field === field
      ? activeServerError.code
      : undefined
  }

  function errorProps(field: ErrorField) {
    const invalid = errorFor(field) !== undefined
    return {
      'aria-invalid': invalid,
      'aria-describedby': invalid ? `${field}-error` : undefined,
    }
  }

  function errorMessage(field: ErrorField) {
    const code = errorFor(field)
    return (
      code && (
        <p id={`${field}-error`} role="alert" className="error">
          {ERROR_MESSAGES[code]}
        </p>
      )
    )
  }

  function handleSubmit(event: { preventDefault(): void }) {
    event.preventDefault()
    setSubmitted(true)
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
            onBlur={() => touch('username')}
            {...errorProps('username')}
          />
          {errorMessage('username')}
        </div>

        <fieldset
          className="field colors"
          aria-describedby={errorProps('color')['aria-describedby']}
        >
          <legend>Color</legend>
          {COLORS.map((color) => (
            <label key={color}>
              <input
                type="radio"
                name="color"
                value={color}
                checked={values.color === color}
                onChange={() => setValue('color', color)}
              />
              {colorLabel(color)}
            </label>
          ))}
          {errorMessage('color')}
        </fieldset>

        <div className="field">
          <label htmlFor="gameName">Game name</label>
          <input
            id="gameName"
            value={values.gameName}
            onChange={(event) => setValue('gameName', event.target.value)}
            onBlur={() => touch('gameName')}
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
                onBlur={() => touch('board')}
                aria-invalid={errorProps('board')['aria-invalid']}
              />
            </div>
          ))}
          {errorMessage('board')}
        </fieldset>

        {activeServerError && !activeServerError.field && (
          <p role="alert" className="error">
            {ERROR_MESSAGES[activeServerError.code]}
          </p>
        )}

        <button type="submit">Create</button>
      </form>
    </main>
  )
}
