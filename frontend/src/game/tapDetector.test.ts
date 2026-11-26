import { describe, expect, it } from 'vitest'
import { createTapDetector } from './tapDetector'

const start = { x: 100, y: 100 }

describe('tapDetector', () => {
  it.each([
    [{ x: 100, y: 100 }, 'tap'],
    [{ x: 105, y: 105 }, 'tap'],
    [{ x: 108, y: 100 }, 'pan'],
    [{ x: 106, y: 106 }, 'pan'],
  ])('reads a pointer lifted at %o as a %s', (end, gesture) => {
    const detector = createTapDetector()
    detector.down(1, start)

    expect(detector.up(1, end)).toBe(gesture)
  })

  it('stays a pan after coming back to the start', () => {
    const detector = createTapDetector()
    detector.down(1, start)

    expect(detector.move(1, { x: 130, y: 100 })).toBe('pan')
    expect(detector.up(1, start)).toBe('pan')
  })

  it('is a pinch with a second pointer, and never a tap', () => {
    const detector = createTapDetector()
    detector.down(1, start)
    detector.down(2, { x: 200, y: 100 })

    expect(detector.up(2, { x: 200, y: 100 })).toBe('pinch')
    expect(detector.up(1, start)).toBe('pinch')
  })

  it('starts over once every pointer is up', () => {
    const detector = createTapDetector()
    detector.down(1, start)
    detector.down(2, start)
    detector.up(1, start)
    detector.up(2, start)

    detector.down(3, start)

    expect(detector.up(3, start)).toBe('tap')
  })

  it('forgets a cancelled pointer', () => {
    const detector = createTapDetector()
    detector.down(1, start)
    detector.cancel(1)

    detector.down(2, start)

    expect(detector.up(2, start)).toBe('tap')
  })

  it('ignores a pointer it never saw go down', () => {
    const detector = createTapDetector()

    expect(detector.move(1, start)).toBeNull()
    expect(detector.up(1, start)).toBeNull()
  })
})
