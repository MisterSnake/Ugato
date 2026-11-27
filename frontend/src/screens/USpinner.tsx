import type { CSSProperties } from 'react'

const GLYPHS = 16

/** A turning ring of U's. Decorative: the screen says in text what it waits for. */
export function USpinner() {
  return (
    <div aria-hidden="true" className="u-spinner" data-testid="u-spinner">
      {Array.from({ length: GLYPHS }, (_, index) => {
        // 0 at the left of the ring and 1 at the right, to run the gradient.
        const mix = (1 + Math.sin((2 * Math.PI * index) / GLYPHS)) / 2
        return (
          <span
            key={index}
            style={
              {
                '--angle': `${(360 / GLYPHS) * index}deg`,
                '--mix': `${Math.round(mix * 100)}%`,
              } as CSSProperties
            }
          >
            U
          </span>
        )
      })}
    </div>
  )
}
