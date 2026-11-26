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
  invalid_timer: 'Choose a timer.',
  game_not_found: 'That game is no longer available.',
  game_full: 'That game is full.',
  username_taken: 'That name is already used in this game.',
  color_taken: 'That color is already used in this game.',
  game_in_progress: 'That game has already started',
  game_not_started: 'The game has not started.',
  not_your_turn: 'It is not your turn.',
  choice_pending: 'Choose your U first.',
  cell_out_of_bounds: 'That cell is outside the board.',
  cell_taken: 'That cell is already taken.',
  no_choice_pending: 'There is no U to choose.',
  invalid_choice: 'That U is not available.',
  no_proposals_left: 'You have no proposals to end the game left.',
  vote_pending: 'Wait for the vote to finish.',
  no_vote_pending: 'There is no vote open.',
  already_voted: 'You have already voted.',
  proposer_cannot_vote: 'Your proposal already counts as your vote.',
  invalid_vote: 'That vote is not valid.',
  already_in_game: 'You already have a game.',
  invalid_message: 'The server could not read the request.',
}
