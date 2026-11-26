import type { ErrorCode } from '../game/types'
import { ERROR_MESSAGES } from './errorMessages'

interface ErrorMessageProps {
  code: ErrorCode | undefined
  id?: string
}

export function ErrorMessage({ code, id }: ErrorMessageProps) {
  return (
    code && (
      <p id={id} role="alert" className="error">
        {ERROR_MESSAGES[code]}
      </p>
    )
  )
}
