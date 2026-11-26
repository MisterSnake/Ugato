import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { createGameSocket } from './game/gameSocket'
import { isFull } from './game/isFull'
import type { GameSocket, GameSocketFactory } from './game/gameSocket'
import type {
  CreateGameRequest,
  GameSummary,
  JoinGameRequest,
  LobbyState,
  Role,
  ServerError,
} from './game/types'
import { waitingGameFlag } from './game/waitingGameFlag'
import { CreateGameForm } from './screens/CreateGameForm'
import { HomeScreen } from './screens/HomeScreen'
import { JoinGameForm } from './screens/JoinGameForm'
import { WaitingScreen } from './screens/WaitingScreen'

type View =
  | { screen: 'home'; notice?: string }
  | { screen: 'form'; serverError?: ServerError }
  // Only the name is kept: the game itself is always read from the live lobby.
  | { screen: 'join'; gameName: string; serverError?: ServerError }
  | { screen: 'waiting'; game: GameSummary; role: Role }

const CONNECTING: LobbyState = { status: 'connecting', games: [] }
const DISCONNECTED: LobbyState = { status: 'disconnected', games: [] }

const CONNECTION_LOST_NOTICES: Record<Role, string> = {
  host: 'Connection lost, the game was removed',
  player: 'Connection lost, you left the game',
}
const GAME_FULL_NOTICE = 'That game is full'
const GAME_GONE_NOTICE = 'That game is no longer available'
const GAME_CLOSED_NOTICE = 'The host closed the game'

interface AppProps {
  createSocket?: GameSocketFactory
}

// Same origin as the page; in development, Vite proxies /api to the backend.
function gameSocketUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
  return `${protocol}://${window.location.host}/api/ws`
}

// The join form cannot outlive a game that is gone or has no room left.
function viewAfterLobbyUpdate(view: View, games: GameSummary[]): View {
  if (view.screen !== 'join') return view
  const game = games.find(({ name }) => name === view.gameName)
  if (!game) return { screen: 'home', notice: GAME_GONE_NOTICE }
  return isFull(game) ? { screen: 'home', notice: GAME_FULL_NOTICE } : view
}

// An error answers a form. One that arrives after the user left it is dropped.
function viewAfterServerError(view: View, serverError: ServerError): View {
  switch (view.screen) {
    case 'form':
      return { ...view, serverError }
    case 'join':
      if (serverError.code === 'game_full') {
        return { screen: 'home', notice: GAME_FULL_NOTICE }
      }
      if (serverError.code === 'game_not_found') {
        return { screen: 'home', notice: GAME_GONE_NOTICE }
      }
      return { ...view, serverError }
    case 'home':
    case 'waiting':
      return view
  }
}

function viewAfterConnectionLoss(view: View): View {
  switch (view.screen) {
    case 'waiting':
      return { screen: 'home', notice: CONNECTION_LOST_NOTICES[view.role] }
    case 'form':
    case 'join':
      return { screen: 'home' }
    case 'home':
      return view
  }
}

// A game still flagged at load time was lost when the page was refreshed.
function initialView(): View {
  const role = waitingGameFlag.get()
  return role
    ? { screen: 'home', notice: CONNECTION_LOST_NOTICES[role] }
    : { screen: 'home' }
}

function App({ createSocket = createGameSocket }: AppProps) {
  const [view, setView] = useState(initialView)
  const [lobby, setLobby] = useState(CONNECTING)
  const socketRef = useRef<GameSocket | null>(null)

  // Cleared here, not in initialView, which StrictMode runs twice.
  useEffect(() => waitingGameFlag.clear(), [])

  // StrictMode opens, closes and reopens the socket. That is safe, because
  // subscribing changes nothing on the server; create_game and join_game are only
  // sent on submit.
  const connectOnLoad = useEffectEvent(() => connect())
  useEffect(() => {
    connectOnLoad()
    return () => socketRef.current?.close()
  }, [])

  function enterWaitingRoom(game: GameSummary, role: Role) {
    waitingGameFlag.set(role)
    setView({ screen: 'waiting', game, role })
  }

  function openSocket(): GameSocket {
    const socket = createSocket(gameSocketUrl())
    socket.on('games_list', (games) => {
      setLobby({ status: 'ready', games })
      setView((current) => viewAfterLobbyUpdate(current, games))
    })
    socket.on('game_created', (game) => {
      enterWaitingRoom(game, 'host')
    })
    socket.on('game_joined', (game) => enterWaitingRoom(game, 'player'))
    socket.on('game_updated', (game) =>
      setView((current) =>
        current.screen === 'waiting' ? { ...current, game } : current,
      ),
    )
    socket.on('game_closed', () => {
      waitingGameFlag.clear()
      setView({ screen: 'home', notice: GAME_CLOSED_NOTICE })
    })
    socket.on('error', (serverError) =>
      setView((current) => viewAfterServerError(current, serverError)),
    )
    socket.on('close', ({ intentional }) => {
      if (intentional) return
      waitingGameFlag.clear()
      socketRef.current = null
      setLobby(DISCONNECTED)
      setView(viewAfterConnectionLoss)
    })
    return socket
  }

  function connect() {
    socketRef.current = openSocket()
    socketRef.current.subscribeLobby()
  }

  // Only ever called by the user: there is no automatic reconnection.
  function retry() {
    setLobby(CONNECTING)
    connect()
  }

  function createGame(request: CreateGameRequest) {
    // "Create game" is only enabled while there is a connected socket.
    socketRef.current?.createGame(request)
  }

  function joinGame(request: JoinGameRequest) {
    socketRef.current?.joinGame(request)
  }

  // The lobby is shown right away, without waiting for the server's reply.
  function leaveGame(role: Role) {
    waitingGameFlag.clear()
    if (role === 'host') socketRef.current?.cancel()
    else socketRef.current?.leave()
    setView({ screen: 'home' })
  }

  switch (view.screen) {
    case 'home':
      return (
        <HomeScreen
          lobby={lobby}
          notice={view.notice}
          onRetry={retry}
          onCreateGame={() => setView({ screen: 'form' })}
          onJoin={(gameName) => setView({ screen: 'join', gameName })}
        />
      )
    case 'form':
      return (
        <CreateGameForm onSubmit={createGame} serverError={view.serverError} />
      )
    case 'join': {
      const game = lobby.games.find(({ name }) => name === view.gameName)
      return (
        game && (
          <JoinGameForm
            game={game}
            onSubmit={joinGame}
            onBack={() => setView({ screen: 'home' })}
            serverError={view.serverError}
          />
        )
      )
    }
    case 'waiting':
      return (
        <WaitingScreen
          game={view.game}
          role={view.role}
          onLeave={() => leaveGame(view.role)}
        />
      )
  }
}

export default App
