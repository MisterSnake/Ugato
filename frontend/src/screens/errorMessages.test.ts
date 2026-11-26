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
