import { describe, expect, it } from 'vitest'
import type { SessionId, SessionSummary } from '@deepseek-ai/dsh-client-runtime/client'
import { diffSessionSummaries } from '../src/client/diff.ts'

function summary(
  id: string,
  overrides: Partial<SessionSummary> = {},
): [SessionId, SessionSummary] {
  return [id as SessionId, {
    id: id as SessionId,
    displayTitle: `会话-${id}`,
    blank: false,
    running: false,
    updatedAt: 1_700_000_000_000,
    ...overrides,
  }]
}

function toRecord(entries: Array<[SessionId, SessionSummary]>): Record<SessionId, SessionSummary> {
  return Object.fromEntries(entries) as Record<SessionId, SessionSummary>
}

describe('diffSessionSummaries', () => {
  it('pendingInteraction 无→有：产生 interaction 通知（approval）', () => {
    const prev = toRecord([summary('s1')])
    const next = toRecord([summary('s1', { pendingInteraction: 'approval' })])
    const notices = diffSessionSummaries(prev, next, undefined)
    expect(notices).toEqual([
      { kind: 'interaction', sessionId: 's1', interaction: 'approval', title: '会话-s1' },
    ])
  })

  it('question / plan-review 同样触发 interaction', () => {
    for (const interaction of ['question', 'plan-review'] as const) {
      const prev = toRecord([summary('s1')])
      const next = toRecord([summary('s1', { pendingInteraction: interaction })])
      expect(diffSessionSummaries(prev, next, undefined)[0]?.interaction).toBe(interaction)
    }
  })

  it('running true→false 且非当前会话：产生 completed 通知', () => {
    const prev = toRecord([summary('s1', { running: true })])
    const next = toRecord([summary('s1', { running: false })])
    const notices = diffSessionSummaries(prev, next, 's2')
    expect(notices).toEqual([{ kind: 'completed', sessionId: 's1', title: '会话-s1' }])
  })

  it('当前选中会话的完成不通知（用户正在看它）', () => {
    const prev = toRecord([summary('s1', { running: true })])
    const next = toRecord([summary('s1', { running: false })])
    expect(diffSessionSummaries(prev, next, 's1')).toEqual([])
  })

  it('首次出现的会话只建立基线，不通知', () => {
    const prev = toRecord([])
    const next = toRecord([summary('s1', { running: true, pendingInteraction: 'approval' })])
    expect(diffSessionSummaries(prev, next, undefined)).toEqual([])
  })

  it('pendingInteraction 持续存在（有→有）不重复通知', () => {
    const prev = toRecord([summary('s1', { pendingInteraction: 'approval' })])
    const next = toRecord([summary('s1', { pendingInteraction: 'approval' })])
    expect(diffSessionSummaries(prev, next, undefined)).toEqual([])
  })

  it('running 保持 true 不通知', () => {
    const prev = toRecord([summary('s1', { running: true })])
    const next = toRecord([summary('s1', { running: true })])
    expect(diffSessionSummaries(prev, next, undefined)).toEqual([])
  })

  it('被移除的会话不通知', () => {
    const prev = toRecord([summary('s1', { running: true })])
    const next = toRecord([])
    expect(diffSessionSummaries(prev, next, undefined)).toEqual([])
  })
})
