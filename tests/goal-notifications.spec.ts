import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { updateVolatile } from '@deepseek-ai/cosmokit'
import { Config } from '../src/config.ts'
import { apply } from '../src/index.ts'
import { delivered, resetDelivered } from './stubs/node-notifier.ts'

function goal(id: string, phase = 'active', operation = phase === 'complete' ? 'complete' : 'create') {
  return { type: 'goal/change', data: { operation, goal: { id, phase } } }
}

function harness(enabled = true, history: ReturnType<typeof goal>[] = [], origin?: string) {
  const runtime = Config({
    triggers: { goalCompletionOnly: enabled },
    system: { enabled: true },
    dedup: { completedDebounceMs: 100, interactionCooldownMs: 10000 },
  })
  const ctx = new Context()
  apply(ctx, runtime)
  const events = history.map((event, seq) => ({ ...event, seq }))
  const session = {
    id: 'root', header: { origin, parentSession: 'fork-source' },
    firstLiveSeq: events.length, snapshotEvents: () => events,
  }
  const agent = { id: session.id, session }
  const status = (value: string) => ctx.emit('agent/status', { agent, status: value } as never)
  const event = (value: ReturnType<typeof goal>) => {
    const stamped = { ...value, seq: events.length }
    events.push(stamped)
    ctx.emit('session/event', session as never, stamped as never)
    return stamped
  }
  const cycle = () => { status('running'); status('idle'); vi.advanceTimersByTime(101) }
  return { runtime, ctx, session, agent, event, status, cycle }
}

describe('optional host Goal notifications', () => {
  beforeEach(() => { vi.useFakeTimers(); resetDelivered() })
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers() })

  it('defaults off and keeps the existing turn-completion behavior with a goal', () => {
    expect(Config({}).triggers.goalCompletionOnly.get()).toBe(false)
    const h = harness(false, [goal('g1')])
    h.event(goal('g1', 'complete'))
    expect(delivered).toHaveLength(0)
    h.cycle()
    expect(delivered).toHaveLength(1)
    expect(delivered[0]?.title).toBe('任务完成')
  })

  it('keeps ordinary root/fork turn completions when enabled', () => {
    harness().cycle()
    expect(delivered).toHaveLength(1)
  })

  it.each(['active', 'paused', 'blocked'])('suppresses %s goals across rounds and exhaustion', phase => {
    const h = harness(true, [goal('g1', phase)])
    h.cycle(); h.cycle()
    expect(delivered).toHaveLength(0)
  })

  it('notifies once on a live completion, without waiting for idle or inheriting a blocked reason', () => {
    const h = harness(true, [goal('g1')])
    h.status('running')
    h.ctx.emit('session/event', h.session as never, {
      type: 'turn/end', seq: 1, data: { turn: 1, reason: { kind: 'blocked' } },
    } as never)
    const completed = h.event(goal('g1', 'complete'))
    expect(delivered).toHaveLength(1)
    expect(delivered[0]?.title).toBe('Goal 已完成')
    expect(delivered[0]?.message ?? '').not.toContain('阻塞')
    h.ctx.emit('session/event', h.session as never, completed as never)
    h.status('idle'); h.cycle()
    vi.advanceTimersByTime(20000)
    h.event(goal('g1', 'complete'))
    expect(delivered).toHaveLength(1)
  })

  it('delivers two distinct goals inside one debounce/cooldown window', () => {
    const h = harness()
    h.event(goal('g1')); h.event(goal('g1', 'complete'))
    h.event(goal('g2')); h.event(goal('g2', 'complete'))
    expect(delivered).toHaveLength(2)
  })

  it('does not backfill restored completions, even after clearing and receiving an old duplicate', () => {
    const h = harness(true, [goal('g1', 'complete'), { type: 'goal/change', data: { operation: 'clear', goal: { id: 'g1', phase: 'complete' } } }])
    h.status('running')
    h.event(goal('g1', 'complete'))
    h.status('idle'); vi.advanceTimersByTime(101)
    expect(delivered).toHaveLength(0)
  })

  it('clear in a running goal is not completion; a later goal-free run can notify', () => {
    const h = harness(true, [goal('g1')])
    h.status('running')
    h.event({ type: 'goal/change', data: { operation: 'clear', goal: { id: 'g1', phase: 'active' } } })
    h.status('idle'); vi.advanceTimersByTime(101)
    expect(delivered).toHaveLength(0)
    h.cycle()
    expect(delivered).toHaveLength(1)
  })

  it('a goal created during ordinary completion debounce cancels that pending turn notice', () => {
    const h = harness()
    h.status('running'); h.status('idle')
    h.event(goal('g1'))
    vi.advanceTimersByTime(101)
    expect(delivered).toHaveLength(0)
  })

  it('requires both the complete operation and complete phase', () => {
    const h = harness(true, [goal('g1')])
    h.event(goal('g1', 'active', 'complete'))
    h.event(goal('g2', 'complete', 'edit'))
    expect(delivered).toHaveLength(0)
  })

  it('subagents never send completion notices', () => {
    const h = harness(true, [], 'subagent')
    h.event(goal('g1')); h.event(goal('g1', 'complete')); h.cycle()
    expect(delivered).toHaveLength(0)
  })

  it('error and completion switches remain independent, with live volatile updates', () => {
    const h = harness(true, [goal('g1')])
    updateVolatile(h.runtime.triggers.completed, Config({ triggers: { completed: false } }).triggers.completed)
    h.event(goal('g1', 'complete'))
    h.ctx.emit('agent/error', { agent: h.agent, error: new Error('fixture'), turn: 1, step: 1 } as never)
    expect(delivered).toHaveLength(1)
    expect(delivered[0]?.title).toBe('任务出错')
    updateVolatile(h.runtime.triggers.error, Config({ triggers: { error: false } }).triggers.error)
    vi.advanceTimersByTime(20000)
    h.ctx.emit('agent/error', { agent: h.agent, error: new Error('fixture') } as never)
    expect(delivered).toHaveLength(1)
    updateVolatile(h.runtime.triggers.completed, Config({ triggers: { completed: true } }).triggers.completed)
    h.event(goal('g1', 'complete'))
    expect(delivered).toHaveLength(1)
  })

  it('enabling after completion does not replay it; a new goal is eligible', () => {
    const h = harness(false)
    h.event(goal('g1')); h.event(goal('g1', 'complete'))
    updateVolatile(h.runtime.triggers.goalCompletionOnly, Config({ triggers: { goalCompletionOnly: true } }).triggers.goalCompletionOnly)
    h.event(goal('g1', 'complete')); h.cycle()
    expect(delivered).toHaveLength(0)
    h.event(goal('g2')); h.event(goal('g2', 'complete'))
    expect(delivered).toHaveLength(1)
  })
})
