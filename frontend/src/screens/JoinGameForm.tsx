import { useState } from 'react'
import type { GameSummary, JoinGameRequest, ServerError } from '../game/types'
import { validateJoinDraft } from '../game/validation'
import { ColorField } from './ColorField'
import { ErrorMessage } from './ErrorMessage'
import { UserIcon } from './icons'
import { useFieldErrors } from './useFieldErrors'

interface JoinGameFormProps {
  /** The game as the lobby currently lists it. */
  game: GameSummary
  onSubmit: (request: JoinGameRequest) => void
  onBack: () => void
  serverError?: ServerError
}

export function JoinGameForm({
  game,
  onSubmit,
  onBack,
  serverError,
}: JoinGameFormProps) {
  const [username, setUsername] = useState('')
  const [chosenColor, setChosenColor] = useState('')

  const takenColors = new Set(game.players.map((player) => player.color))
  // Derived, so a color that someone else takes is unselected right away.
  const color = [...takenColors].some((taken) => taken === chosenColor)
    ? ''
    : chosenColor

  const result = validateJoinDraft({ gameName: game.name, username, color })
  const errors = useFieldErrors(
    'errors' in result ? result.errors : {},
    serverError,
  )
  const usernameError = errors.errorFor('username')

  function handleSubmit(event: { preventDefault(): void }) {
    event.preventDefault()
    errors.markSubmitted()
    if ('request' in result) onSubmit(result.request)
  }

  return (
    <main className="screen">
      <h1>{`Join ${game.name}`}</h1>
      <form className="card form-card" noValidate onSubmit={handleSubmit}>
        <div className="field">
          <label htmlFor="username">Your name</label>
          <div className="pill">
            <UserIcon />
            <input
              id="username"
              value={username}
              onChange={(event) => {
                setUsername(event.target.value)
                errors.edit('username')
              }}
              onBlur={() => errors.touch('username')}
              {...errors.errorProps('username')}
            />
          </div>
          <ErrorMessage id="username-error" code={usernameError} />
        </div>

        <ColorField
          value={color}
          disabled={takenColors}
          error={errors.errorFor('color')}
          onChange={(next) => {
            setChosenColor(next)
            errors.edit('color')
          }}
        />

        <ErrorMessage code={errors.formError} />

        <div className="actions">
          <button type="button" className="btn-ghost" onClick={onBack}>
            Back
          </button>
          <button type="submit" className="btn">
            Join
          </button>
        </div>
      </form>
    </main>
  )
}
