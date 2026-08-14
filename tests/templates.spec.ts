import { describe, expect, it } from 'vitest'
import { resolveConfig } from '../src/config.ts'
import { baseTitleOf, bodyOf, renderPayload, titleOf } from '../src/templates.ts'
import type { Signal } from '../src/signals.ts'

const config = resolveConfig({})

const interaction: Signal = {
  kind: 'interaction', sessionId: 's1', interaction: 'approval', toolName: 'bash', reason: '需要授权', seq: 1,
}
const completed: Signal = { kind: 'completed', sessionId: 's1', reason: { kind: 'completed' }, turn: 2, seq: 2 }
const aborted: Signal = { kind: 'completed', sessionId: 's1', reason: { kind: 'aborted', reason: 'user' }, seq: 3 }
const maxTokens: Signal = { kind: 'completed', sessionId: 's1', reason: { kind: 'max-tokens' }, seq: 3 }
const error: Signal = { kind: 'error', sessionId: 's1', message: 'boom', turn: 1, step: 0, seq: 4 }

describe('titleOf', () => {
  it('交互标题按类型细分', () => {
    expect(baseTitleOf(interaction)).toBe('需要交互：等待审批')
    expect(baseTitleOf({ ...interaction, interaction: 'question' })).toBe('需要交互：等待回答')
  })

  it('完成标题按结束原因细分', () => {
    expect(baseTitleOf(completed)).toBe('任务完成')
    expect(baseTitleOf(aborted)).toBe('任务中止')
    expect(baseTitleOf(maxTokens)).toBe('输出达上限')
  })

  it('错误标题', () => {
    expect(baseTitleOf(error)).toBe('任务出错')
  })

  it('titlePrefix 前缀', () => {
    const withPrefix = resolveConfig({ message: { titlePrefix: '[DSH]' } })
    expect(titleOf({ signal: completed, config: withPrefix, verbosity: 'normal' })).toBe('[DSH] 任务完成')
  })
})

describe('bodyOf', () => {
  it('minimal → 空正文', () => {
    for (const signal of [interaction, completed, error]) {
      expect(bodyOf({ signal, config, verbosity: 'minimal' })).toBe('')
    }
  })

  it('normal：审批带工具名、完成带原因、错误带消息、含会话标题', () => {
    const withTitle = { ...config, message: { ...config.message, includeSessionTitle: true } }
    expect(bodyOf({ signal: interaction, config: withTitle, sessionTitle: '修 bug', verbosity: 'normal' }))
      .toBe('等待审批：bash\n会话：修 bug')
    expect(bodyOf({ signal: aborted, config, verbosity: 'normal' })).toBe('任务被中止')
    expect(bodyOf({ signal: error, config, verbosity: 'normal' })).toBe('错误：boom')
  })

  it('normal：includeSessionTitle=false 时不含会话标题', () => {
    const noTitle = resolveConfig({ message: { includeSessionTitle: false } })
    expect(bodyOf({ signal: interaction, config: noTitle, sessionTitle: '修 bug', verbosity: 'normal' }))
      .toBe('等待审批：bash')
  })

  it('detailed：追加 turn/step、原因与 GUI 链接', () => {
    const body = bodyOf({ signal: interaction, config, sessionTitle: 't', verbosity: 'detailed' })
    expect(body).toContain('原因：需要授权')
    expect(body).toContain('打开：http://127.0.0.1:3080')
    expect(bodyOf({ signal: completed, config, verbosity: 'detailed' })).toContain('turn 2')
    expect(bodyOf({ signal: error, config, verbosity: 'detailed' })).toContain('turn 1 / step 0')
  })
})

describe('renderPayload', () => {
  it('组合标题/正文/链接', () => {
    const payload = renderPayload({ signal: completed, config, sessionTitle: '任务A', verbosity: 'normal' })
    expect(payload.title).toBe('任务完成')
    expect(payload.body).toContain('会话：任务A')
    expect(payload.url).toBe('http://127.0.0.1:3080')
    expect(payload.sessionId).toBe('s1')
  })
})
