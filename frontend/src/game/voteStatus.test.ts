import { describe, expect, it } from 'vitest'
import { makeState } from '../test/gameState'
import type { GameState, Vote } from './types'
import { canProposeEnd, voteProgress, voteTitle } from './voteStatus'

const vote: Vote = {
  proposer: 'Esteban',
  voted: 1,
  total: 3,
  secondsLeft: 30,
  yourVote: null,
}

describe('canProposeEnd', () => {
  it("allows it on the user's turn with attempts left", () => {
    const state = makeState({ endProposalsLeft: { Ana: 1, Esteban: 0 } })

    expect(canProposeEnd(state, 'Ana')).toBe(true)
  })

  it.each<[string, Partial<GameState>]>([
    ['out of turn', { currentPlayer: 'Esteban' }],
    ['while choosing a U', { phase: 'choose' }],
    ['during a vote', { vote: { ...vote, proposer: 'Ana' } }],
    ['without attempts', { endProposalsLeft: { Ana: 0, Esteban: 2 } }],
  ])('forbids it %s', (_, state) => {
    expect(canProposeEnd(makeState(state), 'Ana')).toBe(false)
  })
})

describe('the vote texts', () => {
  it('tells the proposer apart from the others', () => {
    expect(voteTitle(vote, 'Esteban')).toBe('You proposed ending the game')
    expect(voteTitle(vote, 'Ana')).toBe('Esteban wants to end the game')
  })

  it('says how many have voted', () => {
    expect(voteProgress(vote)).toBe('1 of 3 voted')
  })
})
