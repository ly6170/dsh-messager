/** Host-side goal baseline. Historical events are state, never notifications. */
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-goal'

interface GoalState {
  hasGoal: boolean
  completed: Set<string>
  /** Retain suppression through a clear in the middle of a running turn. */
  goalInRun: boolean
}

export class GoalNotifications {
  private readonly states = new WeakMap<Session, GoalState>()

  private state(session: Session, beforeSeq = Infinity): GoalState {
    let state = this.states.get(session)
    if (state !== undefined) return state
    state = { hasGoal: false, completed: new Set(), goalInRun: false }
    // session/event is published after append, so exclude the live event when
    // establishing a baseline from inside that callback.
    for (const event of session.snapshotEvents()) {
      if (event.seq >= beforeSeq || event.type !== 'goal/change') continue
      const change = event.data
      state.hasGoal = change.operation !== 'clear'
      if (change.operation !== 'clear' && change.goal.phase === 'complete') {
        state.completed.add(change.goal.id)
      }
    }
    this.states.set(session, state)
    return state
  }

  startRun(session: Session): void {
    const state = this.state(session)
    state.goalInRun = state.hasGoal
  }

  suppressTurn(session: Session): boolean {
    const state = this.state(session)
    return state.hasGoal || state.goalInRun
  }

  /** Return a fresh live completion ID; consume it even if notifications are off. */
  change(session: Session, event: SessionEvent): string | undefined {
    if (event.type !== 'goal/change') return undefined
    const state = this.state(session, event.seq)
    const change = event.data
    state.hasGoal = change.operation !== 'clear'
    if (state.hasGoal) state.goalInRun = true
    if (change.operation === 'clear' || change.goal.phase !== 'complete') return undefined
    const seen = state.completed.has(change.goal.id)
    state.completed.add(change.goal.id)
    if (seen || change.operation !== 'complete' || event.seq < session.firstLiveSeq) return undefined
    return change.goal.id
  }
}
