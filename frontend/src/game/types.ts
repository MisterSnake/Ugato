export const COLORS = [
  'red',
  'blue',
  'yellow',
  'green',
  'orange',
  'purple',
] as const

export type Color = (typeof COLORS)[number]

export interface CreateGameRequest {
  username: string
  color: Color
  gameName: string
  maxPlayers: number
  boardWidth: number
  boardHeight: number
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

export interface GameSummary {
  name: string
  maxPlayers: number
  boardWidth: number
  boardHeight: number
  players: Player[]
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

export type ErrorCode =
  | 'invalid_username'
  | 'invalid_color'
  | 'invalid_game_name'
  | 'name_taken'
  | 'invalid_max_players'
  | 'invalid_board'
  | 'game_not_found'
  | 'game_full'
  | 'username_taken'
  | 'color_taken'
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
  | ({ type: 'error' } & ServerError)
