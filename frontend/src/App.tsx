import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { createGameSocket } from './game/gameSocket'
import type { GameSocket, GameSocketFactory } from './game/gameSocket'
import type {
  CreateGameRequest,
  GameOver,
  GameState,
  GameSummary,
  JoinGameRequest,
  LobbyState,
  Player,
  Role,
  ServerError,
  VoteFailed,
} from './game/types'
import { waitingGameFlag } from './game/waitingGameFlag'
import { CreateGameForm } from './screens/CreateGameForm'
import { GameScreen } from './screens/GameScreen'
import { HomeScreen } from './screens/HomeScreen'
import { JoinGameForm } from './screens/JoinGameForm'
import { WaitingScreen } from './screens/WaitingScreen'
import { WinnerScreen } from './screens/WinnerScreen'

type View =
  | { screen: 'home'; notice?: string }
  | { screen: 'form'; serverError?: ServerError }
  // Only the name is kept: the game itself is always read from the live lobby.
  | { screen: 'join'; gameName: string; serverError?: ServerError }
  // `me` is the user's own name in the game.
  | { screen: 'waiting'; game: GameSummary; role: Role; me: string }
  // The states name players only, so their colors come from the waiting room.
  | {
      screen: 'playing'
      state: GameState
      players: Player[]
      me: string
      /** The last failed vote, until the next move. */
      failedVote?: VoteFailed
      /** Who last lost a turn to the clock, until the next move. */
      timedOut?: string
    }
  | { screen: 'finished'; gameOver: GameOver; me: string }

const CONNECTING: LobbyState = { status: 'connecting', games: [] }
const DISCONNECTED: LobbyState = { status: 'disconnected', games: [] }

const CONNECTION_LOST_NOTICES: Record<Role, string> = {
  host: 'Connection lost, the game was removed',
  player: 'Connection lost, you left the game',
}
const GAME_FULL_NOTICE = 'That game is full'
const GAME_STARTED_NOTICE = 'That game has already started'
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

// The join form cannot outlive a game that is gone or has started.
function viewAfterLobbyUpdate(view: View, games: GameSummary[]): View {
  if (view.screen !== 'join') return view
  const game = games.find(({ name }) => name === view.gameName)
  if (!game) return { screen: 'home', notice: GAME_GONE_NOTICE }
  return game.status === 'playing'
    ? { screen: 'home', notice: GAME_STARTED_NOTICE }
    : view
}

// The notice of a failed vote lasts until the next move or proposal. The state
// sent along with the failure brings neither. The notice of a timeout lasts until
// the next mark: the state sent along with it already passes the turn.
function viewAfterGameState(view: View, state: GameState): View {
  if (view.screen !== 'playing') return view
  const marked =
    state.lastMove?.row !== view.state.lastMove?.row ||
    state.lastMove?.col !== view.state.lastMove?.col
  const moved = marked || state.currentPlayer !== view.state.currentPlayer
  const failedVote = moved || state.vote ? undefined : view.failedVote
  const timedOut = marked ? undefined : view.timedOut
  return { ...view, state, failedVote, timedOut }
}

// An error answers a form. One that arrives after the user left it is dropped.
function viewAfterServerError(view: View, serverError: ServerError): View {
  switch (view.screen) {
    case 'form':
      return { ...view, serverError }
    case 'join':
      if (serverError.code === 'game_in_progress') {
        return { screen: 'home', notice: GAME_STARTED_NOTICE }
      }
      if (serverError.code === 'game_full') {
        return { screen: 'home', notice: GAME_FULL_NOTICE }
      }
      if (serverError.code === 'game_not_found') {
        return { screen: 'home', notice: GAME_GONE_NOTICE }
      }
      return { ...view, serverError }
    case 'home':
    case 'waiting':
    case 'playing':
    case 'finished':
      return view
  }
}

function viewAfterConnectionLoss(view: View): View {
  switch (view.screen) {
    case 'waiting':
      return { screen: 'home', notice: CONNECTION_LOST_NOTICES[view.role] }
    case 'playing':
      // Whoever created the game is just another player once it starts.
      return { screen: 'home', notice: CONNECTION_LOST_NOTICES.player }
    case 'form':
    case 'join':
      return { screen: 'home' }
    case 'home':
    // The game is over, so there is nothing left to lose.
    case 'finished':
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
  // Set from the moment the user cancels their game until they enter another.
  const cancelledRef = useRef(false)

  // Cleared here, not in initialView, which StrictMode runs twice.
  useEffect(() => waitingGameFlag.clear(), [])

  // A refresh during play loses the game too, as a player even for its creator.
  useEffect(() => {
    if (view.screen === 'playing') waitingGameFlag.set('player')
  }, [view.screen])

  // StrictMode opens, closes and reopens the socket. That is safe, because
  // subscribing changes nothing on the server; create_game and join_game are only
  // sent on submit.
  const connectOnLoad = useEffectEvent(() => connect())
  useEffect(() => {
    connectOnLoad()
    return () => socketRef.current?.close()
  }, [])

  function enterWaitingRoom(game: GameSummary, role: Role) {
    cancelledRef.current = false
    waitingGameFlag.set(role)
    // The host is the first player. Whoever has just joined is the last one.
    const self = role === 'host' ? game.players[0] : game.players.at(-1)!
    setView({ screen: 'waiting', game, role, me: self.name })
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
    socket.on('game_started', (state) => {
      // The server can start a game before it reads the cancel_game, which it
      // then ignores. Without leaving, the host would stay seated unseen.
      if (cancelledRef.current) {
        cancelledRef.current = false
        socket.leave()
      }
      setView((current) =>
        current.screen === 'waiting'
          ? {
              screen: 'playing',
              state,
              players: current.game.players,
              me: current.me,
            }
          : current,
      )
    })
    socket.on('game_state', (state) =>
      setView((current) => viewAfterGameState(current, state)),
    )
    socket.on('vote_failed', (failedVote) =>
      setView((current) =>
        current.screen === 'playing' ? { ...current, failedVote } : current,
      ),
    )
    socket.on('turn_timed_out', ({ player }) =>
      setView((current) =>
        current.screen === 'playing'
          ? { ...current, timedOut: player }
          : current,
      ),
    )
    socket.on('game_over', (gameOver) => {
      waitingGameFlag.clear()
      setView((current) =>
        current.screen === 'playing'
          ? { screen: 'finished', gameOver, me: current.me }
          : current,
      )
    })
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
  // While waiting, a host cancels the game; everyone else just leaves it.
  function leaveGame(role: Role) {
    waitingGameFlag.clear()
    if (role === 'host') {
      cancelledRef.current = true
      socketRef.current?.cancel()
    } else socketRef.current?.leave()
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
    case 'playing':
      return (
        <GameScreen
          state={view.state}
          players={view.players}
          me={view.me}
          failedVote={view.failedVote}
          timedOut={view.timedOut}
          onMark={(row, col) => socketRef.current?.markCell(row, col)}
          onChoose={(index) => socketRef.current?.chooseU(index)}
          onPropose={() => socketRef.current?.proposeEnd()}
          onVote={(end) => socketRef.current?.voteEnd(end)}
          onLeave={() => leaveGame('player')}
        />
      )
    case 'finished':
      return (
        <WinnerScreen
          gameOver={view.gameOver}
          me={view.me}
          onClose={() => setView({ screen: 'home' })}
        />
      )
  }
}

export default App
