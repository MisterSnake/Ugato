import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { USpinner } from './USpinner'

describe('USpinner', () => {
  it('is a decorative ring of U glyphs', () => {
    const { container } = render(<USpinner />)
    const ring = container.firstElementChild!

    expect(ring).toHaveAttribute('aria-hidden', 'true')
    expect([...ring.children].map((glyph) => glyph.textContent)).toEqual(
      Array(16).fill('U'),
    )
  })
})
