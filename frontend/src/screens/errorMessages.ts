import {
  BOARD_MAX_SIZE,
  BOARD_MIN_SIZE,
  MAX_PLAYERS,
  MIN_PLAYERS,
  NAME_MAX_LENGTH,
  NAME_MIN_LENGTH,
} from '../game/validation'
import type { ErrorCode } from '../game/types'

const NAME_RANGE = `${NAME_MIN_LENGTH}-${NAME_MAX_LENGTH} printable characters`

export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  invalid_username: `Your name must be ${NAME_RANGE}.`,
  invalid_color: 'Choose a color.',
  invalid_game_name: `The game name must be ${NAME_RANGE}.`,
  name_taken: 'That game name is already taken.',
  invalid_max_players: `Max players must be between ${MIN_PLAYERS} and ${MAX_PLAYERS}.`,
  invalid_board: `Width and height must be ${BOARD_MIN_SIZE}-${BOARD_MAX_SIZE}, and height cannot exceed width.`,
  game_not_found: 'That game is no longer available.',
  game_full: 'That game is full.',
  username_taken: 'That name is already used in this game.',
  color_taken: 'That color is already used in this game.',
  already_in_game: 'You already have a game.',
  invalid_message: 'The server could not read the request.',
}
