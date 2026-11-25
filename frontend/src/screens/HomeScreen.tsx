interface HomeScreenProps {
  onCreateGame: () => void
  notice?: string
}

export function HomeScreen({ onCreateGame, notice }: HomeScreenProps) {
  return (
    <main className="screen">
      <h1>Ugato</h1>
      {notice && (
        <p role="alert" className="notice">
          {notice}
        </p>
      )}
      <button type="button" onClick={onCreateGame}>
        Create game
      </button>
    </main>
  )
}
