import type {
  CreateGameRequest,
  GameSummary,
  JoinGameRequest,
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
  game_joined: GameSummary
  game_updated: GameSummary
  game_closed: undefined
  games_list: GameSummary[]
  error: ServerError
  close: { intentional: boolean }
}

type Handlers = {
  [E in keyof GameSocketEvents]: Array<(payload: GameSocketEvents[E]) => void>
}

export interface GameSocket {
  subscribeLobby(): void
  createGame(request: CreateGameRequest): void
  joinGame(request: JoinGameRequest): void
  cancel(): void
  leave(): void
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
  const handlers: Handlers = {
    game_created: [],
    game_joined: [],
    game_updated: [],
    game_closed: [],
    games_list: [],
    error: [],
    close: [],
  }
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
    if (
      message.type === 'game_created' ||
      message.type === 'game_joined' ||
      message.type === 'game_updated'
    ) {
      emit(message.type, message.game)
    } else if (message.type === 'game_closed') {
      emit('game_closed', undefined)
    } else if (message.type === 'games_list') {
      emit('games_list', message.games)
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
    subscribeLobby() {
      send({ type: 'subscribe_lobby' })
    },
    createGame(request) {
      send({ type: 'create_game', ...request })
    },
    joinGame(request) {
      send({ type: 'join_game', ...request })
    },
    cancel() {
      send({ type: 'cancel_game' })
    },
    leave() {
      send({ type: 'leave_game' })
    },
    close,
    on(event, handler) {
      handlers[event].push(handler)
    },
  }
}
