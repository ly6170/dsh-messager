import { describe, expect, it } from 'vitest'
import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionStatus, SessionStatusSnapshot } from '@deepseek-ai/dsh-client-ui-session/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { diffPendingInteractions, diffSessionSummaries } from '../src/client/diff.ts'

function sessionId(id: string): SessionId {
  return id as SessionId
}

function summary(
  id: string,
  overrides: Partial<SessionSummary> = {},
): [SessionId, SessionSummary] {
  const branded = sessionId(id)
  return [branded, {
    id: branded,
    displayTitle: `会话-${id}`,
    blank: false,
    running: false,
    retainedBy: {},
    updatedAt: 1_700_000_000_000,
    ...overrides,
  }]
}

function toRecord(entries: Array<[SessionId, SessionSummary]>): Record<SessionId, SessionSummary> {
  return Object.fromEntries(entries) as Record<SessionId, SessionSummary>
}

function status(
  id: string,
  pendingKind?: string,
  key = `${pendingKind}:1`,
): [SessionId, SessionStatus] {
  const branded = sessionId(id)
  return [branded, {
    running: false,
    pendingInteraction: pendingKind === undefined ? undefined : { key, kind: pendingKind, sessionId: branded },
    completionUnread: false,
  }]
}

function toStatus(entries: Array<[SessionId, SessionStatus]>): SessionStatusSnapshot {
  return new Map(entries)
}

describe('diffPendingInteractions', () => {
  it('approval / question / plan-review 从无到有时产生交互通知', () => {
    const summaries = toRecord([summary('s1')])
    for (const kind of ['approval', 'question', 'plan-review'] as const) {
      expect(diffPendingInteractions(
        toStatus([status('s1')]),
        toStatus([status('s1', kind)]),
        summaries,
      )).toEqual([{
        kind: 'interaction', sessionId: 's1', interaction: kind, title: '会话-s1',
      }])
    }
  })

  it('交互持续存在时不重复通知', () => {
    const previous = toStatus([status('s1', 'approval', 'approval:1')])
    const next = toStatus([status('s1', 'approval', 'approval:2')])
    expect(diffPendingInteractions(previous, next, toRecord([summary('s1')]))).toEqual([])
  })

  it('交互移除后重新出现会再次通知', () => {
    const active = toStatus([status('s1', 'question')])
    const inactive = toStatus([status('s1')])
    const summaries = toRecord([summary('s1')])
    expect(diffPendingInteractions(active, inactive, summaries)).toEqual([])
    expect(diffPendingInteractions(inactive, active, summaries)).toHaveLength(1)
  })

  it('未知 kind 忽略', () => {
    expect(diffPendingInteractions(
      toStatus([]),
      toStatus([status('s1', 'future-interaction')]),
      toRecord([summary('s1')]),
    )).toEqual([])
  })

  it('缺少会话摘要时仍通知但不带标题', () => {
    expect(diffPendingInteractions(
      toStatus([]),
      toStatus([status('s1', 'approval')]),
      toRecord([]),
    )).toEqual([{ kind: 'interaction', sessionId: 's1', interaction: 'approval' }])
  })

  it('当前快照作为 previous 时只建立基线、不补发历史通知', () => {
    const current = toStatus([status('s1', 'plan-review')])
    expect(diffPendingInteractions(current, current, toRecord([summary('s1')]))).toEqual([])
  })
})

describe('diffSessionSummaries', () => {
  it('running true→false 且不在主视图时产生 completed 通知', () => {
    const prev = toRecord([summary('s1', { running: true })])
    const next = toRecord([summary('s1', { running: false })])
    expect(diffSessionSummaries(prev, next)).toEqual([
      { kind: 'completed', sessionId: 's1', title: '会话-s1' },
    ])
  })

  it('主视图中的会话完成不通知', () => {
    const prev = toRecord([summary('s1', { running: true })])
    const next = toRecord([summary('s1', { retainedBy: { mainView: 1 } })])
    expect(diffSessionSummaries(prev, next)).toEqual([])
  })

  it('其他 retain 来源不抑制完成通知', () => {
    const prev = toRecord([summary('s1', { running: true })])
    const next = toRecord([summary('s1', { retainedBy: { gateway: 1 } })])
    expect(diffSessionSummaries(prev, next)).toHaveLength(1)
  })

  it('首次出现的会话只建立基线、不通知', () => {
    const prev = toRecord([])
    const next = toRecord([summary('s1', { running: true })])
    expect(diffSessionSummaries(prev, next)).toEqual([])
  })

  it('running 保持 true 不通知', () => {
    const prev = toRecord([summary('s1', { running: true })])
    const next = toRecord([summary('s1', { running: true })])
    expect(diffSessionSummaries(prev, next)).toEqual([])
  })

  it('被移除的会话不通知', () => {
    const prev = toRecord([summary('s1', { running: true })])
    expect(diffSessionSummaries(prev, toRecord([]))).toEqual([])
  })
})