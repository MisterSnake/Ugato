import { useState } from 'react'
import {
  BOARD_MAX_SIZE,
  BOARD_MIN_SIZE,
  MAX_PLAYERS,
  MIN_PLAYERS,
  TIMER_LABELS,
  validateDraft,
} from '../game/validation'
import type {
  CreateGameRequest,
  ErrorField,
  ServerError,
} from '../game/types'
import { ColorField } from './ColorField'
import { ErrorMessage } from './ErrorMessage'
import { ClockIcon, GridIcon, UserIcon, UsersIcon } from './icons'
import { Stepper } from './Stepper'
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
    timer: 'none',
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
      <form className="card form-card" noValidate onSubmit={handleSubmit}>
        <div className="field">
          <label htmlFor="username">Your name</label>
          <div className="pill">
            <UserIcon />
            <input
              id="username"
              value={values.username}
              onChange={(event) => setValue('username', event.target.value)}
              onBlur={() => errors.touch('username')}
              {...errorProps('username')}
            />
          </div>
          {errorMessage('username')}
        </div>

        <ColorField
          value={values.color}
          error={errors.errorFor('color')}
          onChange={(color) => setValue('color', color)}
        />

        <div className="field">
          <label htmlFor="gameName">Game name</label>
          <div className="pill">
            <input
              id="gameName"
              value={values.gameName}
              onChange={(event) => setValue('gameName', event.target.value)}
              onBlur={() => errors.touch('gameName')}
              {...errorProps('gameName')}
            />
          </div>
          {errorMessage('gameName')}
        </div>

        <fieldset
          className="field segments"
          aria-describedby={errorProps('maxPlayers')['aria-describedby']}
        >
          <legend>Max players</legend>
          <div className="segment-bar">
            {PLAYER_OPTIONS.map((count) => (
              <label key={count} className="segment">
                <input
                  type="radio"
                  name="maxPlayers"
                  value={count}
                  checked={values.maxPlayers === String(count)}
                  onChange={(event) =>
                    setValue('maxPlayers', event.target.value)
                  }
                  aria-invalid={errorProps('maxPlayers')['aria-invalid']}
                />
                <span>
                  {values.maxPlayers === String(count) && <UsersIcon />}
                  {count}
                </span>
              </label>
            ))}
          </div>
          {errorMessage('maxPlayers')}
        </fieldset>

        <fieldset
          className="field board-size"
          aria-describedby={errorProps('board')['aria-describedby']}
        >
          <legend>
            Board size <GridIcon />
          </legend>
          <div className="steppers">
            {(['boardWidth', 'boardHeight'] as const).map((name) => (
              <Stepper
                key={name}
                id={name}
                label={name === 'boardWidth' ? 'Board width' : 'Board height'}
                min={BOARD_MIN_SIZE}
                max={BOARD_MAX_SIZE}
                value={values[name]}
                onChange={(value) => setValue(name, value)}
                onBlur={() => errors.touch('board')}
                invalid={errorProps('board')['aria-invalid']}
              />
            ))}
          </div>
          {errorMessage('board')}
        </fieldset>

        <div className="field">
          <label htmlFor="timer">Timer</label>
          <div className="pill select-pill">
            <ClockIcon />
            <select
              id="timer"
              value={values.timer}
              onChange={(event) => setValue('timer', event.target.value)}
              {...errorProps('timer')}
            >
              {Object.entries(TIMER_LABELS).map(([mode, label]) => (
                <option key={mode} value={mode}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          {errorMessage('timer')}
        </div>

        <ErrorMessage code={errors.formError} />

        <button type="submit" className="btn btn-large form-submit">
          Create
        </button>
      </form>
    </main>
  )
}
