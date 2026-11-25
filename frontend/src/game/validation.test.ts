import { describe, expect, it } from 'vitest'
import { validateDraft } from './validation'
import type { CreateGameDraft } from './validation'

const validDraft: CreateGameDraft = {
  username: 'Esteban',
  color: 'red',
  gameName: 'Partida 1',
  maxPlayers: 2,
  boardWidth: 12,
  boardHeight: 10,
}

function validate(overrides: Partial<CreateGameDraft>) {
  return validateDraft({ ...validDraft, ...overrides })
}

describe('validateDraft', () => {
  it('returns the typed request with trimmed names', () => {
    expect(validate({ username: '  Esteban  ', gameName: ' Partida 1 ' })).toEqual({
      request: validDraft,
    })
  })

  it.each(['Ana', 'a'.repeat(20), 'Ñandú', '𝒜'.repeat(20)])(
    'accepts the name %j',
    (name) => {
      expect(validate({ username: name, gameName: name })).toHaveProperty('request')
    },
  )

  it.each(['Al', '   ', 'a'.repeat(21), 'Est\neban', 'Est eban', '𝒜𝒜'])(
    'rejects the name %j',
    (name) => {
      expect(validate({ username: name, gameName: name })).toEqual({
        errors: { username: 'invalid_username', gameName: 'invalid_game_name' },
      })
    },
  )

  it.each(['red', 'blue', 'yellow', 'green', 'orange', 'purple'])(
    'accepts the color %s',
    (color) => {
      expect(validate({ color })).toHaveProperty('request')
    },
  )

  it.each(['pink', ''])('rejects the color %j', (color) => {
    expect(validate({ color })).toEqual({ errors: { color: 'invalid_color' } })
  })

  it.each([2, 3, 4])('accepts %i max players', (maxPlayers) => {
    expect(validate({ maxPlayers })).toHaveProperty('request')
  })

  it.each([1, 5, 2.5, Number.NaN])('rejects %d max players', (maxPlayers) => {
    expect(validate({ maxPlayers })).toEqual({
      errors: { maxPlayers: 'invalid_max_players' },
    })
  })

  it.each([
    [8, 8],
    [30, 8],
    [30, 30],
  ])('accepts a %i x %i board', (boardWidth, boardHeight) => {
    expect(validate({ boardWidth, boardHeight })).toHaveProperty('request')
  })

  it.each([
    [8, 30],
    [7, 7],
    [31, 10],
    [10, 7],
    [12.5, 10],
    [Number.NaN, 10],
  ])('rejects a %d x %d board', (boardWidth, boardHeight) => {
    expect(validate({ boardWidth, boardHeight })).toEqual({
      errors: { board: 'invalid_board' },
    })
  })
})
