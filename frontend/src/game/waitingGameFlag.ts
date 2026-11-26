// Remembers, across a page refresh, that this tab was waiting in a game, and in
// which role. sessionStorage is per tab; no username or game data is stored.
import type { Role } from './types'

const KEY = 'ugato.waitingGame'

export const waitingGameFlag = {
  set(role: Role): void {
    window.sessionStorage.setItem(KEY, role)
  },
  clear(): void {
    window.sessionStorage.removeItem(KEY)
  },
  get(): Role | null {
    const value = window.sessionStorage.getItem(KEY)
    if (value === null) return null
    // Any other value comes from before roles existed, when only hosts waited.
    return value === 'player' ? 'player' : 'host'
  },
}
