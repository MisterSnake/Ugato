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

describe('ERROR_MESSAGES during a vote', () => {
  it.each([
    ['no_proposals_left', 'You have no proposals to end the game left.'],
    ['vote_pending', 'Wait for the vote to finish.'],
    ['no_vote_pending', 'There is no vote open.'],
    ['already_voted', 'You have already voted.'],
    ['proposer_cannot_vote', 'Your proposal already counts as your vote.'],
    ['invalid_vote', 'That vote is not valid.'],
  ] as const)('explains %s', (code, message) => {
    expect(ERROR_MESSAGES[code]).toBe(message)
  })
})

describe('ERROR_MESSAGES for the player limit', () => {
  it('names the allowed range', () => {
    expect(ERROR_MESSAGES.invalid_max_players).toBe(
      'Max players must be between 2 and 5.',
    )
  })
})
