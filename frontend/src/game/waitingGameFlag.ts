// Remembers, across a page refresh, that this tab had a game waiting.
// sessionStorage is per tab; no username or game data is stored.
const KEY = 'ugato.waitingGame'

export const waitingGameFlag = {
  set(): void {
    window.sessionStorage.setItem(KEY, 'true')
  },
  clear(): void {
    window.sessionStorage.removeItem(KEY)
  },
  isSet(): boolean {
    return window.sessionStorage.getItem(KEY) !== null
  },
}
