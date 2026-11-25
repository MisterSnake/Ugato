import { useEffect, useRef, useState } from 'react'
import { createGameSocket } from './game/gameSocket'
import type { GameSocket, GameSocketFactory } from './game/gameSocket'
import type { CreateGameRequest, GameSummary, ServerError } from './game/types'
import { waitingGameFlag } from './game/waitingGameFlag'
import { CreateGameForm } from './screens/CreateGameForm'
import { HomeScreen } from './screens/HomeScreen'
import { WaitingScreen } from './screens/WaitingScreen'

type View =
  | { screen: 'home'; notice?: string }
  | { screen: 'form'; serverError?: ServerError }
  | { screen: 'waiting'; game: GameSummary }

const CONNECTION_LOST_NOTICE = 'Connection lost, the game was removed'

interface AppProps {
  createSocket?: GameSocketFactory
}

// Same origin as the page; in development, Vite proxies /api to the backend.
function gameSocketUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
  return `${protocol}://${window.location.host}/api/ws`
}

// A game still flagged at load time was lost when the page was refreshed.
function initialView(): View {
  return waitingGameFlag.isSet()
    ? { screen: 'home', notice: CONNECTION_LOST_NOTICE }
    : { screen: 'home' }
}

function App({ createSocket = createGameSocket }: AppProps) {
  const [view, setView] = useState(initialView)
  const socketRef = useRef<GameSocket | null>(null)

  // Cleared here, not in initialView, which StrictMode runs twice.
  useEffect(() => waitingGameFlag.clear(), [])
  useEffect(() => () => socketRef.current?.close(), [])

  function openSocket(): GameSocket {
    const socket = createSocket(gameSocketUrl())
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
      setView({ screen: 'home', notice: CONNECTION_LOST_NOTICE })
    })
    return socket
  }

  // The socket is opened on submit, never in an effect, so StrictMode's double
  // effect run cannot create a game.
  function createGame(request: CreateGameRequest) {
    socketRef.current ??= openSocket()
    socketRef.current.createGame(request)
  }

  function cancelGame() {
    waitingGameFlag.clear()
    socketRef.current?.cancel()
    socketRef.current = null
    setView({ screen: 'home' })
  }

  switch (view.screen) {
    case 'home':
      return (
        <HomeScreen
          notice={view.notice}
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
