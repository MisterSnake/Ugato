import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  ClockIcon,
  GamepadIcon,
  GridIcon,
  LockIcon,
  PaletteIcon,
  UserIcon,
  UsersIcon,
} from './icons'

describe('icons', () => {
  it.each(
    Object.entries({
      GamepadIcon,
      LockIcon,
      PaletteIcon,
      UsersIcon,
      GridIcon,
      ClockIcon,
      UserIcon,
    }),
  )('%s is a decorative svg', (_name, Icon) => {
    const { container } = render(<Icon />)

    expect(container.firstElementChild?.tagName).toBe('svg')
    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true')
  })
})
