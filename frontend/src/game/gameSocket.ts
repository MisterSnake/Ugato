import type {
  CreateGameRequest,
  GameOver,
  GameState,
  GameSummary,
  JoinGameRequest,
  ServerError,
  ServerMessage,
  TurnTimedOut,
  VoteFailed,
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
  game_started: GameState
  game_state: GameState
  game_over: GameOver
  vote_failed: VoteFailed
  turn_timed_out: TurnTimedOut
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
  markCell(row: number, col: number): void
  chooseU(index: number): void
  proposeEnd(): void
  voteEnd(end: boolean): void
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
    game_started: [],
    game_state: [],
    game_over: [],
    vote_failed: [],
    turn_timed_out: [],
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
    } else if (
      message.type === 'game_started' ||
      message.type === 'game_state'
    ) {
      emit(message.type, message.state)
    } else if (message.type === 'game_over') {
      const { type: _type, ...gameOver } = message
      emit('game_over', gameOver)
    } else if (message.type === 'vote_failed') {
      const { type: _type, ...failed } = message
      emit('vote_failed', failed)
    } else if (message.type === 'turn_timed_out') {
      const { type: _type, ...timedOut } = message
      emit('turn_timed_out', timedOut)
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
    markCell(row, col) {
      send({ type: 'mark_cell', row, col })
    },
    chooseU(index) {
      send({ type: 'choose_u', index })
    },
    proposeEnd() {
      send({ type: 'propose_end' })
    },
    voteEnd(end) {
      send({ type: 'vote_end', end })
    },
    close,
    on(event, handler) {
      handlers[event].push(handler)
    },
  }
}
