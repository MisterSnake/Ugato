import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { createGameSocket } from './game/gameSocket'
import type { GameSocket, GameSocketFactory } from './game/gameSocket'
import type {
  CreateGameRequest,
  GameSummary,
  LobbyState,
  ServerError,
} from './game/types'
import { waitingGameFlag } from './game/waitingGameFlag'
import { CreateGameForm } from './screens/CreateGameForm'
import { HomeScreen } from './screens/HomeScreen'
import { WaitingScreen } from './screens/WaitingScreen'

type View =
  | { screen: 'home'; notice?: string }
  | { screen: 'form'; serverError?: ServerError }
  | { screen: 'waiting'; game: GameSummary }

const CONNECTING: LobbyState = { status: 'connecting', games: [] }
const DISCONNECTED: LobbyState = { status: 'disconnected', games: [] }

const CONNECTION_LOST_NOTICE = 'Connection lost, the game was removed'

interface AppProps {
  createSocket?: GameSocketFactory
}

// Same origin as the page; in development, Vite proxies /api to the backend.
function gameSocketUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
  return `${protocol}://${window.location.host}/api/ws`
}

function viewAfterConnectionLoss(view: View): View {
  switch (view.screen) {
    case 'waiting':
      return { screen: 'home', notice: CONNECTION_LOST_NOTICE }
    case 'form':
      return { screen: 'home' }
    case 'home':
      return view
  }
}

// A game still flagged at load time was lost when the page was refreshed.
function initialView(): View {
  return waitingGameFlag.isSet()
    ? { screen: 'home', notice: CONNECTION_LOST_NOTICE }
    : { screen: 'home' }
}

function App({ createSocket = createGameSocket }: AppProps) {
  const [view, setView] = useState(initialView)
  const [lobby, setLobby] = useState(CONNECTING)
  const socketRef = useRef<GameSocket | null>(null)

  // Cleared here, not in initialView, which StrictMode runs twice.
  useEffect(() => waitingGameFlag.clear(), [])

  // StrictMode opens, closes and reopens the socket. That is safe, because
  // subscribing changes nothing on the server; create_game is only sent on submit.
  const connectOnLoad = useEffectEvent(() => connect())
  useEffect(() => {
    connectOnLoad()
    return () => socketRef.current?.close()
  }, [])

  function openSocket(): GameSocket {
    const socket = createSocket(gameSocketUrl())
    socket.on('games_list', (games) => setLobby({ status: 'ready', games }))
    socket.on('game_created', (game) => {
      waitingGameFlag.set()
      setView({ screen: 'waiting', game })
    })
    socket.on('error', (serverError) =>
      setView({ screen: 'form', serverError }),
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

  function cancelGame() {
    waitingGameFlag.clear()
    socketRef.current?.cancel()
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
        />
      )
    case 'form':
      return (
        <CreateGameForm onSubmit={createGame} serverError={view.serverError} />
      )
    case 'waiting':
      return <WaitingScreen game={view.game} onCancel={cancelGame} />
  }
}

export default App
