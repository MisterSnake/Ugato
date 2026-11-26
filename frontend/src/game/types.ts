export const COLORS = [
  'red',
  'blue',
  'yellow',
  'green',
  'orange',
  'purple',
] as const

export type Color = (typeof COLORS)[number]

export type TimerMode = 'none' | 'slow' | 'normal' | 'fast'

export interface CreateGameRequest {
  username: string
  color: Color
  gameName: string
  maxPlayers: number
  boardWidth: number
  boardHeight: number
  timer: TimerMode
}

export interface JoinGameRequest {
  gameName: string
  username: string
  color: Color
}

export type Role = 'host' | 'player'

export interface Player {
  name: string
  color: Color
}

export type GameStatus = 'waiting' | 'playing'

export interface GameSummary {
  name: string
  maxPlayers: number
  boardWidth: number
  boardHeight: number
  timer: TimerMode
  status: GameStatus
  /** For a game in progress, only those still in it. */
  players: Player[]
}

export interface Position {
  row: number
  col: number
}

/** A cell is `null` while it is empty. */
export type Cell = { owner: string; disabled: boolean } | null

/** Rows of cells, as `board[row][col]`. */
export type Board = Cell[][]

/** An open vote to end the game. */
export interface Vote {
  proposer: string
  /** How many have voted, the proposer included. */
  voted: number
  /** How many are still in the game. */
  total: number
  secondsLeft: number
  /** The user's own vote. Nobody learns what the others voted. */
  yourVote: 'end' | 'continue' | null
}

export interface VoteFailed {
  proposer: string
  endVotes: number
  continueVotes: number
}

/** A started game. Players are identified by name. */
export interface GameState {
  board: Board
  turnOrder: string[]
  currentPlayer: string
  phase: 'mark' | 'choose'
  scores: Record<string, number>
  leftPlayers: string[]
  lastMove: Position | null
  /** How many more times each player can propose ending the game. */
  endProposalsLeft: Record<string, number>
  vote: Vote | null
  timer: TimerMode
  /** What is left on each clock, in ms. `null` in an untimed game. */
  clocks: Record<string, number> | null
  /** What is left to choose a U, in ms, while the choose clock runs. */
  chooseMsLeft: number | null
  /** Only sent to the player who has to choose a U. */
  candidates?: Position[][]
}

export interface TurnTimedOut {
  /** Who ran out of time and lost the turn. */
  player: string
}

export interface GameOver {
  winners: string[]
  scores: Record<string, number>
  reason: 'board_full' | 'last_player' | 'vote'
  board: Board
}

export interface LobbyState {
  status: 'connecting' | 'ready' | 'disconnected'
  games: GameSummary[]
}

export type ErrorField =
  | 'username'
  | 'color'
  | 'gameName'
  | 'maxPlayers'
  | 'board'
  | 'timer'

export type ErrorCode =
  | 'invalid_username'
  | 'invalid_color'
  | 'invalid_game_name'
  | 'name_taken'
  | 'invalid_max_players'
  | 'invalid_board'
  | 'invalid_timer'
  | 'game_not_found'
  | 'game_full'
  | 'username_taken'
  | 'color_taken'
  | 'game_in_progress'
  | 'game_not_started'
  | 'not_your_turn'
  | 'choice_pending'
  | 'cell_out_of_bounds'
  | 'cell_taken'
  | 'no_choice_pending'
  | 'invalid_choice'
  | 'no_proposals_left'
  | 'vote_pending'
  | 'no_vote_pending'
  | 'already_voted'
  | 'proposer_cannot_vote'
  | 'invalid_vote'
  | 'already_in_game'
  | 'invalid_message'

export interface ServerError {
  field?: ErrorField
  code: ErrorCode
}

export type ServerMessage =
  | { type: 'game_created'; game: GameSummary }
  | { type: 'game_cancelled' }
  | { type: 'game_joined'; game: GameSummary }
  | { type: 'game_left' }
  | { type: 'game_updated'; game: GameSummary }
  | { type: 'game_closed' }
  | { type: 'games_list'; games: GameSummary[] }
  | { type: 'game_started'; state: GameState }
  | { type: 'game_state'; state: GameState }
  | ({ type: 'vote_failed' } & VoteFailed)
  | ({ type: 'turn_timed_out' } & TurnTimedOut)
  | ({ type: 'game_over' } & GameOver)
  | ({ type: 'error' } & ServerError)
