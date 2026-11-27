import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { BOARD_MAX_SIZE, BOARD_MIN_SIZE } from '../game/validation'
import { Stepper } from './Stepper'

function Controlled({ initial }: { initial: string }) {
  const [value, setValue] = useState(initial)
  return (
    <Stepper
      id="width"
      label="Board width"
      min={BOARD_MIN_SIZE}
      max={BOARD_MAX_SIZE}
      value={value}
      onChange={setValue}
    />
  )
}

function renderStepper(initial: string) {
  render(<Controlled initial={initial} />)
  return userEvent.setup()
}

const input = () => screen.getByLabelText('Board width')
const decrease = () =>
  screen.getByRole('button', { name: 'Decrease board width' })
const increase = () =>
  screen.getByRole('button', { name: 'Increase board width' })

describe('Stepper', () => {
  it('changes the value by 1', async () => {
    const user = renderStepper('12')

    await user.click(increase())
    expect(input()).toHaveValue(13)

    await user.click(decrease())
    await user.click(decrease())
    expect(input()).toHaveValue(11)
  })

  it('disables the decrease button at the minimum', async () => {
    const user = renderStepper('9')

    await user.click(decrease())

    expect(input()).toHaveValue(8)
    expect(decrease()).toBeDisabled()
    expect(increase()).toBeEnabled()
  })

  it('disables the increase button at the maximum', async () => {
    const user = renderStepper('29')

    await user.click(increase())

    expect(input()).toHaveValue(30)
    expect(increase()).toBeDisabled()
    expect(decrease()).toBeEnabled()
  })

  it.each([
    ['40', decrease, 30],
    ['3', increase, 8],
  ])(
    'brings %s back into the range with one step',
    async (initial, button, expected) => {
      const user = renderStepper(initial)

      await user.click(button())

      expect(input()).toHaveValue(expected)
    },
  )

  it.each(['', 'abc'])('steps up from the minimum when %j', async (initial) => {
    const user = renderStepper(initial)

    await user.click(increase())

    expect(input()).toHaveValue(9)
  })

  it.each(['', 'abc'])(
    'steps down to the minimum when %j',
    async (initial) => {
      const user = renderStepper(initial)

      await user.click(decrease())

      expect(input()).toHaveValue(8)
    },
  )

  it('still takes typed values, even out of range', async () => {
    const user = renderStepper('8')

    await user.clear(input())
    await user.type(input(), '45')

    expect(input()).toHaveValue(45)
  })
})
