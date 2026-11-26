// Tells a tap from a pan or a pinch, from the pointers on the board.
import type { Point } from './viewport'

export type Gesture = 'tap' | 'pan' | 'pinch'

// A finger that moves less than this has not really moved.
const TAP_THRESHOLD = 8

export interface TapDetector {
  down(pointer: number, at: Point): void
  /** The gesture so far, or `null` for a pointer that is not down. */
  move(pointer: number, to: Point): Gesture | null
  /** What the pointer that is lifted was part of. */
  up(pointer: number, at: Point): Gesture | null
  cancel(pointer: number): void
}

export function createTapDetector(): TapDetector {
  const starts = new Map<number, Point>()
  let gesture: Gesture = 'tap'

  function move(pointer: number, to: Point): Gesture | null {
    const start = starts.get(pointer)
    if (!start) return null
    const moved = Math.hypot(to.x - start.x, to.y - start.y)
    if (gesture === 'tap' && moved >= TAP_THRESHOLD) gesture = 'pan'
    return gesture
  }

  return {
    down(pointer, at) {
      // A gesture lasts from the first pointer down to the last one up.
      if (starts.size === 0) gesture = 'tap'
      else gesture = 'pinch'
      starts.set(pointer, at)
    },
    move,
    up(pointer, at) {
      const result = move(pointer, at)
      starts.delete(pointer)
      return result
    },
    cancel(pointer) {
      starts.delete(pointer)
    },
  }
}
