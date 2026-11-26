import { useState } from 'react'
import type { FieldErrors } from '../game/validation'
import type { ErrorField, ServerError } from '../game/types'

/**
 * Which error each form field shows: the client one once the user has left the
 * field or tried to submit, otherwise the server's.
 */
export function useFieldErrors(
  clientErrors: FieldErrors,
  serverError: ServerError | undefined,
) {
  const [touched, setTouched] = useState<Partial<Record<ErrorField, boolean>>>(
    {},
  )
  const [submitted, setSubmitted] = useState(false)
  // The server error stops applying once the user edits the field it is about.
  const [outdatedError, setOutdatedError] = useState<ServerError>()
  const activeServerError =
    serverError === outdatedError ? undefined : serverError

  function errorFor(field: ErrorField) {
    const clientError =
      submitted || touched[field] ? clientErrors[field] : undefined
    if (clientError) return clientError
    return activeServerError?.field === field
      ? activeServerError.code
      : undefined
  }

  return {
    errorFor,
    errorProps(field: ErrorField) {
      const invalid = errorFor(field) !== undefined
      return {
        'aria-invalid': invalid,
        'aria-describedby': invalid ? `${field}-error` : undefined,
      }
    },
    /** A server error about no particular field. */
    formError: activeServerError?.field ? undefined : activeServerError?.code,
    edit(field: ErrorField) {
      if (serverError?.field === field) setOutdatedError(serverError)
    },
    touch(field: ErrorField) {
      setTouched((current) => ({ ...current, [field]: true }))
    },
    markSubmitted() {
      setSubmitted(true)
    },
  }
}
