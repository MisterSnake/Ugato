interface StepperProps {
  id: string
  label: string
  min: number
  max: number
  /** The raw text of the input. */
  value: string
  onChange: (value: string) => void
  onBlur?: () => void
  invalid?: boolean
}

/** A number input with a button on each side that steps it within its range. */
export function Stepper({
  id,
  label,
  min,
  max,
  value,
  onChange,
  onBlur,
  invalid,
}: StepperProps) {
  // `null` while there is no number to step from.
  const typed =
    value.trim() === '' || !Number.isFinite(Number(value))
      ? null
      : Number(value)

  function step(by: number) {
    const next = (typed ?? min) + by
    onChange(String(Math.min(max, Math.max(min, next))))
  }

  const name = label.toLowerCase()

  return (
    <div className="stepper-field">
      <label htmlFor={id}>{label}</label>
      <div className="stepper">
        <button
          type="button"
          className="stepper-down"
          aria-label={`Decrease ${name}`}
          disabled={typed !== null && typed <= min}
          onClick={() => step(-1)}
        />
        <input
          id={id}
          type="number"
          min={min}
          max={max}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onBlur={onBlur}
          aria-invalid={invalid}
        />
        <button
          type="button"
          className="stepper-up"
          aria-label={`Increase ${name}`}
          disabled={typed !== null && typed >= max}
          onClick={() => step(1)}
        />
      </div>
    </div>
  )
}
