import { describe, expect, it } from 'vitest'
import { ERROR_MESSAGES } from './errorMessages'

// The Record<ErrorCode, string> type makes tsc require a message for every code.
describe('ERROR_MESSAGES', () => {
  it('says that a username is taken in this game', () => {
    expect(ERROR_MESSAGES.username_taken).toBe(
      'That name is already used in this game.',
    )
  })
})

describe('ERROR_MESSAGES during play', () => {
  it('says that a game has already started', () => {
    expect(ERROR_MESSAGES.game_in_progress).toBe(
      'That game has already started',
    )
  })
})
