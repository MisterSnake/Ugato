import { describe, expect, it } from 'vitest'
import { winnerTitle } from './winnerTitle'

describe('winnerTitle', () => {
  it.each([
    [['Ana'], 'You win!'],
    [['Esteban'], 'Esteban wins!'],
    [['Esteban', 'Ana'], 'Draw between Esteban and Ana'],
    [['Esteban', 'Ana', 'Luis'], 'Draw between Esteban, Ana and Luis'],
  ])('tells Ana about the winners %o', (winners, title) => {
    expect(winnerTitle({ winners, reason: 'board_full' }, 'Ana')).toEqual({
      title,
    })
  })

  it('says that everyone else left', () => {
    const over = { winners: ['Ana'], reason: 'last_player' as const }

    expect(winnerTitle(over, 'Ana')).toEqual({
      title: 'You win!',
      detail: 'Everyone else left.',
    })
  })
})
