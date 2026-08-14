import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { apply } from '../src/index.ts'

/** 记录注册调用的假 settings 服务。 */
function fakeSettingsService() {
  const registrations: Array<{ ns: string; hasSchema: boolean; base: unknown }> = []
  const service = {
    register(ns: string, schema: unknown, options: { base?: unknown } = {}) {
      registrations.push({ ns, hasSchema: typeof schema === 'function', base: options.base })
      return {
        get: () => ({}),
        watch: () => () => undefined,
      }
    },
  }
  return { service, registrations }
}

describe('host apply 的 settings 接线', () => {
  it('settings 服务可用时注册 messager 命名空间', async () => {
    const ctx = new Context()
    const { service, registrations } = fakeSettingsService()
    ctx.provide('settings', service)

    apply(ctx, {} as never)
    // 等 inject 子 fiber 启动并完成注册
    await new Promise<void>((resolve) => setTimeout(resolve, 100))

    expect(registrations.map(entry => entry.ns)).toContain('messager')
    expect(registrations[0]?.hasSchema).toBe(true)
  })

  it('settings 服务缺失时插件照常运行（回退默认配置，不抛错）', async () => {
    const ctx = new Context()
    expect(() => apply(ctx, {} as never)).not.toThrow()
    await new Promise<void>((resolve) => setTimeout(resolve, 50))
  })
})
