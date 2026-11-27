import { COLORS } from '../game/types'
import type { Color, ErrorCode } from '../game/types'
import { colorLabel } from './colorLabel'
import { ErrorMessage } from './ErrorMessage'
import { PaletteIcon } from './icons'

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
      <legend>
        <PaletteIcon /> Choose your color
      </legend>
      <div className="color-options">
        {COLORS.map((color) => (
          <label key={color} className={`color-option color-${color}`}>
            <input
              type="radio"
              name="color"
              value={color}
              checked={value === color}
              disabled={disabled?.has(color)}
              onChange={() => onChange(color)}
            />
            {/* The radio stays for keyboard and screen readers. The dot is what shows. */}
            <span aria-hidden="true" className="color-dot" />
            <span className="visually-hidden">{colorLabel(color)}</span>
          </label>
        ))}
      </div>
      <ErrorMessage id="color-error" code={error} />
    </fieldset>
  )
}
