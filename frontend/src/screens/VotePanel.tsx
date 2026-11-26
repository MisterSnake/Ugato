import { useEffect, useState } from 'react'
import type { Vote } from '../game/types'
import { voteCountdown } from '../game/voteCountdown'
import { voteProgress, voteTitle } from '../game/voteStatus'

interface VotePanelProps {
  /** The vote of the latest state. Each state brings a new object. */
  vote: Vote
  /** The user's own name. */
  me: string
  onVote: (end: boolean) => void
}

// The server decides when time is up, so this countdown is only approximate.
function useSecondsLeft(vote: Vote): number {
  const [shown, setShown] = useState({ vote, seconds: vote.secondsLeft })

  useEffect(() => {
    const receivedAt = Date.now()
    const timer = setInterval(() => {
      const seconds = voteCountdown(vote.secondsLeft, receivedAt, Date.now())
      setShown({ vote, seconds })
    }, 1000)
    return () => clearInterval(timer)
  }, [vote])

  // A new vote state shows its own time until its first tick.
  return shown.vote === vote ? shown.seconds : vote.secondsLeft
}

export function VotePanel({ vote, me, onVote }: VotePanelProps) {
  const secondsLeft = useSecondsLeft(vote)

  return (
    <section aria-label="Vote to end the game" className="vote-panel">
      <p className="vote-title">{voteTitle(vote, me)}</p>
      <p>{`${voteProgress(vote)}, ${secondsLeft} s left`}</p>
      {vote.proposer !== me &&
        (vote.yourVote ? (
          <p>You have voted.</p>
        ) : (
          <div className="actions">
            <button type="button" onClick={() => onVote(true)}>
              End game
            </button>
            <button type="button" onClick={() => onVote(false)}>
              Keep playing
            </button>
          </div>
        ))}
    </section>
  )
}
