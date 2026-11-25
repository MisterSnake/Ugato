import type {
  CreateGameRequest,
  GameSummary,
  ServerError,
  ServerMessage,
} from './types'

/** The part of the browser WebSocket this client uses. */
export interface SocketLike {
  addEventListener(type: 'open' | 'close', listener: () => void): void
  addEventListener(
    type: 'message',
    listener: (event: { data: unknown }) => void,
  ): void
  send(data: string): void
  close(): void
}

export type SocketConstructor = new (url: string) => SocketLike

export interface GameSocketEvents {
  game_created: GameSummary
  error: ServerError
  close: { intentional: boolean }
}

type Handlers = {
  [E in keyof GameSocketEvents]: Array<(payload: GameSocketEvents[E]) => void>
}

export interface GameSocket {
  createGame(request: CreateGameRequest): void
  cancel(): void
  close(): void
  on<E extends keyof GameSocketEvents>(
    event: E,
    handler: (payload: GameSocketEvents[E]) => void,
  ): void
}

export type GameSocketFactory = (url: string) => GameSocket

export function createGameSocket(
  url: string,
  WebSocketImpl: SocketConstructor = WebSocket,
): GameSocket {
  const socket = new WebSocketImpl(url)
  const handlers: Handlers = { game_created: [], error: [], close: [] }
  const pending: string[] = []
  let isOpen = false
  let intentionalClose = false

  function emit<E extends keyof GameSocketEvents>(
    event: E,
    payload: GameSocketEvents[E],
  ): void {
    for (const handler of handlers[event]) handler(payload)
  }

  function send(message: object): void {
    const data = JSON.stringify(message)
    if (isOpen) socket.send(data)
    else pending.push(data)
  }

  function close(): void {
    intentionalClose = true
    socket.close()
  }

  socket.addEventListener('open', () => {
    isOpen = true
    for (const data of pending.splice(0)) socket.send(data)
  })

  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data)) as ServerMessage
    if (message.type === 'game_created') {
      emit('game_created', message.game)
    } else if (message.type === 'error') {
      const { type: _type, ...error } = message
      emit('error', error)
    }
  })

  socket.addEventListener('close', () => {
    isOpen = false
    emit('close', { intentional: intentionalClose })
  })

  return {
    createGame(request) {
      send({ type: 'create_game', ...request })
    },
    cancel() {
      send({ type: 'cancel_game' })
      close()
    },
    close,
    on(event, handler) {
      handlers[event].push(handler)
    },
  }
}
