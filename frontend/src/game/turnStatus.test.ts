import { describe, expect, it } from 'vitest'
import { makeState } from '../test/gameState'
import { turnStatus } from './turnStatus'

describe('turnStatus', () => {
  it.each([
    ['mark', 'Esteban', "Ana's turn", false],
    ['mark', 'Ana', 'Your turn!', true],
    ['choose', 'Ana', 'Choose your U', true],
    ['choose', 'Esteban', 'Ana is choosing a U', false],
  ] as const)(
    'in the %s phase of Ana, tells %s "%s"',
    (phase, me, text, isMyTurn) => {
      expect(turnStatus(makeState({ phase }), me)).toEqual({ text, isMyTurn })
    },
  )
})
