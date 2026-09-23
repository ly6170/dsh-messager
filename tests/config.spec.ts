import { describe, expect, it } from 'vitest'
import { resolveConfig, Config, type Config as ConfigShape } from '../src/config.ts'

describe('config schema', () => {
  it('resolves full defaults from an empty input', () => {
    const config = resolveConfig({})
    expect(config.triggers).toEqual({ interaction: true, completed: true, error: true })
    expect(config.system).toEqual({ enabled: true, verbosity: 'normal' })
    expect(config.browser).toEqual({ enabled: true, onlyWhenHidden: true, verbosity: 'normal' })
    expect(config.feishu).toEqual({ enabled: false, timeoutMs: 5000, verbosity: 'normal' })
    expect(config.wecom).toEqual({ enabled: false, timeoutMs: 5000, verbosity: 'normal' })
    expect(config.discord).toEqual({ enabled: false, timeoutMs: 5000, verbosity: 'normal' })
    expect(config.dingtalk).toEqual({ enabled: false, timeoutMs: 5000, verbosity: 'normal' })
    expect(config.telegram).toEqual({ enabled: false, timeoutMs: 5000, verbosity: 'normal' })
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
    // 经 resolveConfig 取纯值：schema 直接调用返回的是 volatile 引用形态
    expect(resolveConfig({ message: { guiUrl: 'not-a-url' } }).message.guiUrl).toBe('not-a-url')
  })
})

describe('config volatile 契约（DSH 0.1.7 设置页写入的前提）', () => {
  /**
   * 递归收集「非 volatile 的叶子路径」。
   * DSH 用 isVolatilePath 门控 settings.mutate：任何非 volatile 路径都会被拒绝，
   * 且完全没有 volatile 字段时整个命名空间被判为不可配置（设置页报废）。
   */
  function plainLeafPaths(node: unknown, path: string[] = []): string[] {
    const schema = node as { dict?: Record<string, unknown>; meta?: { volatile?: boolean } }
    const dict = schema.dict
    if (dict === undefined || Object.keys(dict).length === 0) {
      return schema.meta?.volatile === true ? [] : [path.join('.')]
    }
    return Object.entries(dict).flatMap(([key, child]) => plainLeafPaths(child, [...path, key]))
  }

  it('每个可编辑叶子字段都标记了 volatile', () => {
    expect(plainLeafPaths(Config)).toEqual([])
  })

  it('resolveConfig 会解开 volatile 引用，返回纯值', () => {
    const config = resolveConfig({
      feishu: { enabled: true, webhookUrl: 'https://example.test/hook' },
    })
    expect(typeof config.feishu.enabled).toBe('boolean')
    expect(config.feishu.enabled).toBe(true)
    expect(config.feishu.webhookUrl).toBe('https://example.test/hook')
  })

  it('resolveConfig 同时接受 volatile 形态的输入（Loader 传入的运行时配置）', () => {
    // Config(...) 产出 volatile 形态，模拟 Loader 传给 apply() 的 config
    const runtime = Config({ feishu: { enabled: true, webhookUrl: 'https://example.test/hook' } })
    const config = resolveConfig(runtime)
    expect(config.feishu.enabled).toBe(true)
    expect(config.feishu.webhookUrl).toBe('https://example.test/hook')
    expect(config.feishu.timeoutMs).toBe(5000)
  })
})
