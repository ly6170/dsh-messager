import { describe, expect, it } from 'vitest'
import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionStatus, SessionStatusSnapshot } from '@deepseek-ai/dsh-client-ui-session/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { diffPendingInteractions, diffSessionSummaries, errorNotice, triggerAllows } from '../src/client/diff.ts'

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

  it('主视图中的会话完成不通知（页面可见时的既有语义）', () => {
    const prev = toRecord([summary('s1', { running: true })])
    const next = toRecord([summary('s1', { retainedBy: { mainView: 1 } })])
    expect(diffSessionSummaries(prev, next)).toEqual([])
  })

  it('ignoreMainView（用户没在看窗口）→ 当前打开会话的完成也要通知', () => {
    // v0.3.6：窗口最小化/切到后台时，「跑一个任务然后切走」是最常见用法，
    // 此时主视图仍持有该会话，不过滤掉就会永远收不到完成通知。
    const prev = toRecord([summary('s1', { running: true })])
    const next = toRecord([summary('s1', { retainedBy: { mainView: 1 } })])
    expect(diffSessionSummaries(prev, next, { ignoreMainView: true })).toEqual([
      { kind: 'completed', sessionId: 's1', title: '会话-s1' },
    ])
  })

  it('ignoreMainView 不影响其它过滤（首次出现 / running 未变 / 已移除）', () => {
    const ignore = { ignoreMainView: true }
    expect(diffSessionSummaries(toRecord([]), toRecord([summary('s1', { running: true })]), ignore)).toEqual([])
    expect(diffSessionSummaries(
      toRecord([summary('s1', { running: true })]),
      toRecord([summary('s1', { running: true })]),
      ignore,
    )).toEqual([])
    expect(diffSessionSummaries(
      toRecord([summary('s1', { running: true })]),
      toRecord([]),
      ignore,
    )).toEqual([])
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

describe('errorNotice（api-session/error → 任务出错）', () => {
  it('带会话标题与错误摘要', () => {
    expect(errorNotice(sessionId('s1'), 'boom', toRecord([summary('s1')]))).toEqual({
      kind: 'error', sessionId: 's1', message: 'boom', title: '会话-s1',
    })
  })

  it('缺少会话摘要时仍通知但不带标题', () => {
    expect(errorNotice(sessionId('s1'), 'boom', toRecord([]))).toEqual({
      kind: 'error', sessionId: 's1', message: 'boom',
    })
  })
})

describe('triggerAllows（触发开关门控）', () => {
  const all = { interaction: true, completed: true, error: true }
  const noticeOf = (kind: 'interaction' | 'completed' | 'error') => ({ kind, sessionId: sessionId('s1') })

  it('三类触发分别取对应开关', () => {
    expect(triggerAllows(noticeOf('interaction'), all)).toBe(true)
    expect(triggerAllows(noticeOf('completed'), all)).toBe(true)
    expect(triggerAllows(noticeOf('error'), all)).toBe(true)
  })

  it('关闭某类触发后该类通知被拦下（含 error）', () => {
    expect(triggerAllows(noticeOf('interaction'), { ...all, interaction: false })).toBe(false)
    expect(triggerAllows(noticeOf('completed'), { ...all, completed: false })).toBe(false)
    expect(triggerAllows(noticeOf('error'), { ...all, error: false })).toBe(false)
  })
})