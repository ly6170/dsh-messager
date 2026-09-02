import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { ASK_USER_QUESTION_TOOL, errorMessageOf, interactionSignalOf, turnEndReasonOf } from '../src/signals.ts'

/** 构造最小 SessionEvent（测试用）。 */
function event<T extends string>(type: T, data: Record<string, unknown>, seq = 0): SessionEvent {
  return { type, seq, time: 1_700_000_000_000 + seq, data } as unknown as SessionEvent
}

describe('interactionSignalOf', () => {
  it('approval/asked → approval 交互信号', () => {
    const signal = interactionSignalOf('session-1', event('approval/asked', {
      id: 'approval-1',
      toolName: 'bash',
      reason: 'sandbox escalation',
    }))
    expect(signal).toMatchObject({
      kind: 'interaction',
      sessionId: 'session-1',
      interaction: 'approval',
      toolName: 'bash',
      reason: 'sandbox escalation',
      seq: 0,
    })
  })

  it('approval/asked 无 reason → 不带 reason 字段', () => {
    const signal = interactionSignalOf('s', event('approval/asked', { id: 'a', toolName: 'read' }))
    expect(signal?.kind).toBe('interaction')
    expect(signal).not.toHaveProperty('reason')
  })

  it('ask_user_question 的 tool/call → question 交互信号', () => {
    const signal = interactionSignalOf('s', event('tool/call', {
      turn: 3, step: 1, callId: 'c1', name: ASK_USER_QUESTION_TOOL, arguments: '{}',
    }, 7))
    expect(signal).toMatchObject({
      kind: 'interaction',
      interaction: 'question',
      turn: 3,
      step: 1,
      seq: 7,
    })
  })

  it('其他工具调用 → undefined', () => {
    expect(interactionSignalOf('s', event('tool/call', {
      turn: 1, step: 0, callId: 'c', name: 'read', arguments: '{}',
    }))).toBeUndefined()
  })

  it('无关事件（assistant/message、turn/start）→ undefined', () => {
    expect(interactionSignalOf('s', event('turn/start', { turn: 1 }))).toBeUndefined()
    expect(interactionSignalOf('s', event('assistant/message', {
      turn: 1, step: 0, message: { id: 'm', role: 'assistant', source: { kind: 'model', provider: 'p', model: 'm' }, content: [] },
    }))).toBeUndefined()
  })
})

describe('turnEndReasonOf', () => {
  it('turn/end → 提取 reason（DSH sum 类型）', () => {
    expect(turnEndReasonOf(event('turn/end', { turn: 2, reason: { kind: 'completed' } }))).toEqual({
      turn: 2, reason: { kind: 'completed' },
    })
    expect(turnEndReasonOf(event('turn/end', { turn: 2, reason: { kind: 'aborted', reason: { kind: 'user' } } }))?.reason).toEqual({
      kind: 'aborted', reason: { kind: 'user' },
    })
  })

  it('非 turn/end → undefined', () => {
    expect(turnEndReasonOf(event('turn/start', { turn: 1 }))).toBeUndefined()
  })
})

describe('errorMessageOf', () => {
  it('Error → message', () => {
    expect(errorMessageOf(new Error('boom'))).toBe('boom')
  })

  it('非 Error → String()', () => {
    expect(errorMessageOf('oops')).toBe('oops')
    expect(errorMessageOf({ code: 42 })).toBe('[object Object]')
  })

  it('超长截断', () => {
    expect(errorMessageOf('x'.repeat(500))).toHaveLength(301)
    expect(errorMessageOf('x'.repeat(500)).endsWith('…')).toBe(true)
  })
})
