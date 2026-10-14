import { describe, expect, it } from 'vitest'
import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { ClientCompletionTracker, diffSessionSummaries } from '../src/client/diff.ts'

function snapshot(phase: string | null, running = false, id = 'g1', extra: object = {}) {
  return { root: {
    id: 'root', displayTitle: 'Fixture', running, retainedBy: {},
    projectionValues: { goal: phase === null ? null : { goal: { id, phase } } },
    ...extra,
  } } as unknown as Record<SessionId, SessionSummary>
}
const options = { goalCompletionOnly: true }

describe('client Goal completion semantics', () => {
  it('preserves legacy behavior when disabled', () => {
    expect(diffSessionSummaries(snapshot('active', true), snapshot('active'))).toHaveLength(1)
  })
  it.each(['active', 'paused', 'blocked'])('does not complete on idle with a %s goal', phase => {
    expect(diffSessionSummaries(snapshot(phase, true), snapshot(phase), options)).toEqual([])
  })
  it('completes on durable phase transition while still running, not on later idle', () => {
    const tracker = new ClientCompletionTracker()
    expect(tracker.diff(snapshot('active', true), snapshot('complete', true), options)[0]?.goalId).toBe('g1')
    expect(tracker.diff(snapshot('complete', true), snapshot('complete'), options)).toEqual([])
  })
  it('baselines initial and missing projections without catch-up', () => {
    const tracker = new ClientCompletionTracker()
    expect(tracker.diff({}, snapshot('complete'), options)).toEqual([])
    expect(tracker.diff(snapshot('active'), snapshot('complete'), options)).toEqual([])
    expect(diffSessionSummaries(snapshot(null, true, 'g1', { projectionValues: {} }), snapshot('complete'), options)).toEqual([])
    expect(diffSessionSummaries(snapshot(null, true), snapshot(null, false, 'g1', { projectionValues: {} }), options)).toEqual([])
  })
  it('notifies distinct goals separately, including a create/complete coalesced into one snapshot', () => {
    const tracker = new ClientCompletionTracker()
    expect(tracker.diff(snapshot(null), snapshot('complete'), options)).toHaveLength(1)
    expect(tracker.diff(snapshot('complete'), snapshot('complete', false, 'g2'), options)).toHaveLength(1)
    expect(tracker.diff(snapshot('active'), snapshot('complete'), options)).toEqual([])
  })
  it('clear during a run suppresses idle, but the next goal-free run completes normally', () => {
    const tracker = new ClientCompletionTracker()
    expect(tracker.diff(snapshot('active', true), snapshot(null, true), options)).toEqual([])
    expect(tracker.diff(snapshot(null, true), snapshot(null), options)).toEqual([])
    tracker.diff(snapshot(null), snapshot(null, true), options)
    expect(tracker.diff(snapshot(null, true), snapshot(null), options)).toHaveLength(1)
  })
  it('retains visibility behavior and consumes goals completed in the foreground', () => {
    const visible = snapshot('complete', true, 'g1', { retainedBy: { mainView: 1 } })
    const tracker = new ClientCompletionTracker()
    expect(tracker.diff(snapshot('active', true), visible, options)).toEqual([])
    expect(tracker.diff(snapshot('active', true), snapshot('complete'), options)).toEqual([])
    expect(diffSessionSummaries(snapshot('active', true), visible, { ...options, ignoreMainView: true })).toHaveLength(1)
  })
  it('excludes subagents and retains root forks', () => {
    expect(diffSessionSummaries(snapshot('active'), snapshot('complete', false, 'g1', { origin: 'subagent' }), options)).toEqual([])
    expect(diffSessionSummaries(snapshot('active'), snapshot('complete', false, 'g1', { parentSession: 'source' }), options)).toHaveLength(1)
  })
  it('does not replay a completion after enabling the option', () => {
    const tracker = new ClientCompletionTracker()
    tracker.diff(snapshot('active'), snapshot('complete'))
    expect(tracker.diff(snapshot('active'), snapshot('complete'), options)).toEqual([])
  })
})
