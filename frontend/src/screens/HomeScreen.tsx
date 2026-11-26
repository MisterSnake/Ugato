import type { GameSummary, LobbyState } from '../game/types'
import { TIMER_LABELS } from '../game/validation'
import { colorLabel } from './colorLabel'

interface HomeScreenProps {
  lobby: LobbyState
  onCreateGame: () => void
  onJoin: (gameName: string) => void
  onRetry: () => void
  notice?: string
}

export function HomeScreen({
  lobby,
  onCreateGame,
  onJoin,
  onRetry,
  notice,
}: HomeScreenProps) {
  return (
    <main className="screen">
      <h1>Ugato</h1>
      {notice && (
        <p role="alert" className="notice">
          {notice}
        </p>
      )}
      <button
        type="button"
        onClick={onCreateGame}
        disabled={lobby.status !== 'ready'}
      >
        Create game
      </button>
      <h2>Open games</h2>
      <OpenGames lobby={lobby} onJoin={onJoin} onRetry={onRetry} />
    </main>
  )
}

function OpenGames({
  lobby,
  onJoin,
  onRetry,
}: Pick<HomeScreenProps, 'lobby' | 'onJoin' | 'onRetry'>) {
  switch (lobby.status) {
    case 'connecting':
      return <p>Loading games...</p>
    case 'disconnected':
      return (
        <>
          <p>Can't reach the server.</p>
          <button type="button" onClick={onRetry}>
            Retry
          </button>
        </>
      )
    case 'ready':
      if (lobby.games.length === 0) return <p>No games yet. Create one!</p>
      return (
        <ul className="games">
          {lobby.games.map((game) => (
            // Open game names are unique, so they work as keys.
            <GameRow key={game.name} game={game} onJoin={onJoin} />
          ))}
        </ul>
      )
  }
}

function GameRow({
  game,
  onJoin,
}: {
  game: GameSummary
  onJoin: HomeScreenProps['onJoin']
}) {
  const [host] = game.players

  return (
    <li>
      <strong>{game.name}</strong>
      <dl>
        <dt>Host</dt>
        <dd>{`${host.name} (${colorLabel(host.color)})`}</dd>
        <dt>Players</dt>
        <dd>{`${game.players.length} / ${game.maxPlayers}`}</dd>
        <dt>Board</dt>
        <dd>{`${game.boardWidth} x ${game.boardHeight}`}</dd>
        <dt>Timer</dt>
        <dd>{TIMER_LABELS[game.timer]}</dd>
      </dl>
      {game.status === 'playing' ? (
        <p className="in-progress">In progress</p>
      ) : (
        <button type="button" onClick={() => onJoin(game.name)}>
          Join
        </button>
      )}
    </li>
  )
}
