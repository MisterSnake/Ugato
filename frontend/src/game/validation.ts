// Mirrors backend/app/games/validation.py. The server is the source of truth.
import { COLORS } from './types'
import type {
  Color,
  CreateGameRequest,
  ErrorCode,
  ErrorField,
  JoinGameRequest,
  TimerMode,
} from './types'

export const NAME_MIN_LENGTH = 3
export const NAME_MAX_LENGTH = 20
export const MIN_PLAYERS = 2
export const MAX_PLAYERS = 4
export const BOARD_MIN_SIZE = 8
export const BOARD_MAX_SIZE = 30

/** Every timer mode and its name on screen, in the order they are offered. */
export const TIMER_LABELS: Record<TimerMode, string> = {
  none: 'No timer',
  slow: 'Slow 60-15',
  normal: 'Normal 30-10',
  fast: 'Fast 10-5',
}

// Same set as Python's str.isprintable: no control or separator characters,
// except the plain space.
const PRINTABLE = /^(?: |[^\p{C}\p{Z}])*$/u

export type CreateGameDraft = Omit<CreateGameRequest, 'color' | 'timer'> & {
  color: string
  timer: string
}

export type FieldErrors = Partial<Record<ErrorField, ErrorCode>>

export type ValidationResult =
  | { request: CreateGameRequest }
  | { errors: FieldErrors }

function isValidName(name: string): boolean {
  // Spread to count code points, as the server does.
  const { length } = [...name]
  return (
    length >= NAME_MIN_LENGTH &&
    length <= NAME_MAX_LENGTH &&
    PRINTABLE.test(name)
  )
}

function isColor(value: string): value is Color {
  return (COLORS as readonly string[]).includes(value)
}

function isTimerMode(value: string): value is TimerMode {
  return Object.hasOwn(TIMER_LABELS, value)
}

function isIntegerBetween(value: number, min: number, max: number): boolean {
  return Number.isInteger(value) && value >= min && value <= max
}

function isValidBoard(width: number, height: number): boolean {
  return (
    isIntegerBetween(width, BOARD_MIN_SIZE, BOARD_MAX_SIZE) &&
    isIntegerBetween(height, BOARD_MIN_SIZE, BOARD_MAX_SIZE) &&
    width >= height
  )
}

export function validateDraft(draft: CreateGameDraft): ValidationResult {
  const username = draft.username.trim()
  const gameName = draft.gameName.trim()
  const { color, maxPlayers, boardWidth, boardHeight, timer } = draft
  const errors: FieldErrors = {}

  if (!isValidName(username)) errors.username = 'invalid_username'
  if (!isColor(color)) errors.color = 'invalid_color'
  if (!isValidName(gameName)) errors.gameName = 'invalid_game_name'
  if (!isIntegerBetween(maxPlayers, MIN_PLAYERS, MAX_PLAYERS)) {
    errors.maxPlayers = 'invalid_max_players'
  }
  if (!isValidBoard(boardWidth, boardHeight)) errors.board = 'invalid_board'
  if (!isTimerMode(timer)) errors.timer = 'invalid_timer'

  if (
    Object.keys(errors).length > 0 ||
    !isColor(color) ||
    !isTimerMode(timer)
  ) {
    return { errors }
  }
  return {
    request: {
      username,
      color,
      gameName,
      maxPlayers,
      boardWidth,
      boardHeight,
      timer,
    },
  }
}

export type JoinGameDraft = Omit<JoinGameRequest, 'color'> & { color: string }

export type JoinValidationResult =
  | { request: JoinGameRequest }
  | { errors: FieldErrors }

// The game name is not checked: it comes from the lobby, and the server reports
// a game that no longer exists.
export function validateJoinDraft(draft: JoinGameDraft): JoinValidationResult {
  const username = draft.username.trim()
  const { gameName, color } = draft
  const errors: FieldErrors = {}

  if (!isValidName(username)) errors.username = 'invalid_username'
  if (!isColor(color)) errors.color = 'invalid_color'

  if (Object.keys(errors).length > 0 || !isColor(color)) return { errors }
  return { request: { gameName, username, color } }
}
