import { beforeEach, describe, expect, it } from 'vitest'
import { waitingGameFlag } from './waitingGameFlag'

describe('waitingGameFlag', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
  })

  it('is empty by default', () => {
    expect(waitingGameFlag.get()).toBeNull()
  })

  it.each(['host', 'player'] as const)('remembers the %s role', (role) => {
    waitingGameFlag.set(role)

    expect(waitingGameFlag.get()).toBe(role)
  })

  it('reads a flag stored before roles existed as the host', () => {
    window.sessionStorage.setItem('ugato.waitingGame', 'true')

    expect(waitingGameFlag.get()).toBe('host')
  })

  it('is removed by clear()', () => {
    waitingGameFlag.set('player')

    waitingGameFlag.clear()

    expect(waitingGameFlag.get()).toBeNull()
    expect(window.sessionStorage).toHaveLength(0)
  })
})
