import { describe, expect, it } from 'vitest'
import { resolveConfig, Config, type Config as ConfigShape } from '../src/config.ts'

describe('config schema', () => {
  it('resolves full defaults from an empty input', () => {
    const config = resolveConfig({})
    expect(config.triggers).toEqual({ interaction: true, completed: true, error: true })
    expect(config.system).toEqual({ enabled: true, verbosity: 'normal' })
    expect(config.browser).toEqual({ enabled: true, onlyWhenHidden: true, verbosity: 'normal' })
    expect(config.feishu).toEqual({ enabled: false, timeoutMs: 5000, verbosity: 'normal' })
    expect(config.dedup).toEqual({
      interactionCooldownMs: 10000,
      completedDebounceMs: 1000,
      perChannelPerMinute: 20,
    })
    expect(config.message).toEqual({
      includeSessionTitle: true,
      guiUrl: 'http://127.0.0.1:3080',
    })
  })

  it('deep-merges a partial user layer over defaults', () => {
    const config = resolveConfig({
      triggers: { interaction: false } as ConfigShape['triggers'],
      feishu: { enabled: true, webhookUrl: 'https://example.test/hook' },
    })
    expect(config.triggers.interaction).toBe(false)
    expect(config.triggers.completed).toBe(true) // 未覆盖的字段保持默认
    expect(config.feishu.enabled).toBe(true)
    expect(config.feishu.webhookUrl).toBe('https://example.test/hook')
    expect(config.feishu.timeoutMs).toBe(5000)
    expect(config.browser.onlyWhenHidden).toBe(true)
  })

  it('the schema is callable and validates loudly', () => {
    expect(() => Config({ feishu: { enabled: 'yes' } })).toThrow()
    expect(Config({ message: { guiUrl: 'not-a-url' } }).message.guiUrl).toBe('not-a-url')
  })
})
