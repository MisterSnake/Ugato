import type { GameSummary, LobbyState } from '../game/types'
import { colorLabel } from './colorLabel'

interface HomeScreenProps {
  lobby: LobbyState
  onCreateGame: () => void
  onRetry: () => void
  notice?: string
}

export function HomeScreen({
  lobby,
  onCreateGame,
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
      <OpenGames lobby={lobby} onRetry={onRetry} />
    </main>
  )
}

function OpenGames({
  lobby,
  onRetry,
}: Pick<HomeScreenProps, 'lobby' | 'onRetry'>) {
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
            <GameRow key={game.name} game={game} />
          ))}
        </ul>
      )
  }
}

function GameRow({ game }: { game: GameSummary }) {
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
      </dl>
    </li>
  )
}
