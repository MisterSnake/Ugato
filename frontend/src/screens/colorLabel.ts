import type { Color } from '../game/types'

export function colorLabel(color: Color): string {
  return color.charAt(0).toUpperCase() + color.slice(1)
}
