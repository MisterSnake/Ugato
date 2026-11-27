/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** The game WebSocket URL. Unset, it is /api/ws on the page's own host. */
  readonly VITE_WS_URL?: string
}
