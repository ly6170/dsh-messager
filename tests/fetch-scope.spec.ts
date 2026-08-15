import { describe, expect, it, vi } from 'vitest'
import { createFetchScope, type ConfigFetcher } from '../src/client/fetch-scope.ts'
import type { ConfigView } from '../src/config-shared.ts'

const readyView: ConfigView = {
  status: 'ready',
  value: { triggers: { interaction: true } },
  user: {},
  base: undefined,
  writable: true,
  mode: 'host',
  revision: 1,
}

function fakeFetcher(overrides: Partial<ConfigFetcher> = {}): ConfigFetcher & {
  get: ReturnType<typeof vi.fn>
  write: ReturnType<typeof vi.fn>
} {
  const get = vi.fn(async () => readyView)
  const write = vi.fn(async () => ({ ok: true }))
  return { get, write, ...overrides } as ConfigFetcher & {
    get: ReturnType<typeof vi.fn>
    write: ReturnType<typeof vi.fn>
  }
}

describe('createFetchScope', () => {
  it('初始 loading，refresh 后 ready（getSnapshot 稳定引用，usES 契约）', async () => {
    const fetcher = fakeFetcher()
    const { scope, refresh } = createFetchScope(fetcher)
    const initial = scope.getSnapshot()
    expect(initial.status).toBe('loading')
    await refresh()
    const next = scope.getSnapshot()
    expect(next.status).toBe('ready')
    expect(next.value).toEqual({ triggers: { interaction: true } })
    expect(next.revision).toBe(1)
    expect(scope.getSnapshot()).toBe(next) // 未变化返回同一引用
    expect(initial).not.toBe(next)
  })

  it('subscribe：refresh 后通知订阅者', async () => {
    const fetcher = fakeFetcher()
    const { scope, refresh } = createFetchScope(fetcher)
    const listener = vi.fn()
    scope.subscribe(listener)
    await refresh()
    expect(listener).toHaveBeenCalled()
  })

  it('拉取失败 → unavailable，不抛出', async () => {
    const fetcher = fakeFetcher({ get: vi.fn(async () => { throw new Error('route missing') }) })
    const { scope, refresh } = createFetchScope(fetcher)
    await expect(refresh()).resolves.toBeUndefined()
    expect(scope.getSnapshot().status).toBe('unavailable')
  })

  it('writeOps 成功 → POST 一次 + 重新拉取 + 返回 true', async () => {
    const fetcher = fakeFetcher()
    const { scope } = createFetchScope(fetcher)
    const ok = await scope.writeOps([{ op: 'set', path: ['feishu', 'enabled'], value: true }])
    expect(ok).toBe(true)
    expect(fetcher.write).toHaveBeenCalledWith({
      ops: [{ op: 'set', path: ['feishu', 'enabled'], value: true }],
    })
    expect(fetcher.get).toHaveBeenCalledTimes(1) // 写后重拉（初始 refresh 由调用方触发）
  })

  it('writeOps 失败 → 返回 false 且不重拉', async () => {
    const fetcher = fakeFetcher({ write: vi.fn(async () => ({ ok: false, error: 'conflict' })) })
    const { scope } = createFetchScope(fetcher)
    const ok = await scope.writeOps([{ op: 'set', path: ['a'], value: 1 }])
    expect(ok).toBe(false)
    expect(fetcher.get).toHaveBeenCalledTimes(0)
  })

  it('set/unset 委托为单条 op', async () => {
    const fetcher = fakeFetcher()
    const { scope } = createFetchScope(fetcher)
    await scope.set('system', { enabled: false })
    expect(fetcher.write).toHaveBeenLastCalledWith({ ops: [{ op: 'set', path: ['system'], value: { enabled: false } }] })
    await scope.unset('system')
    expect(fetcher.write).toHaveBeenLastCalledWith({ ops: [{ op: 'unset', path: ['system'] }] })
  })
})
