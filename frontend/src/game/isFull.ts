import type { GameSummary } from './types'

export function isFull(game: GameSummary): boolean {
  return game.players.length >= game.maxPlayers
}
