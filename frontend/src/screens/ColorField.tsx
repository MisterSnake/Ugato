import { COLORS } from '../game/types'
import type { Color, ErrorCode } from '../game/types'
import { colorLabel } from './colorLabel'
import { ErrorMessage } from './ErrorMessage'

interface ColorFieldProps {
  value: string
  onChange: (color: Color) => void
  error: ErrorCode | undefined
  disabled?: ReadonlySet<Color>
}

export function ColorField({
  value,
  onChange,
  error,
  disabled,
}: ColorFieldProps) {
  return (
    <fieldset
      className="field colors"
      aria-describedby={error ? 'color-error' : undefined}
    >
      <legend>Color</legend>
      {COLORS.map((color) => (
        <label key={color}>
          <input
            type="radio"
            name="color"
            value={color}
            checked={value === color}
            disabled={disabled?.has(color)}
            onChange={() => onChange(color)}
          />
          {colorLabel(color)}
        </label>
      ))}
      <ErrorMessage id="color-error" code={error} />
    </fieldset>
  )
}
