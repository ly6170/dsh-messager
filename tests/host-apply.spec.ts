import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { updateVolatile } from '@deepseek-ai/cosmokit'
import { apply } from '../src/index.ts'
import { Config } from '../src/config.ts'
import { resolveNamespace } from '../src/settings.ts'
import { delivered, resetDelivered } from './stubs/node-notifier.ts'

/** 构造一个只含历史标题事件的假会话（模拟进程重启后恢复的会话：历史事件不重放）。 */
function fakeSessionWithHistoricalTitle(id: string, title: string) {
  const events = [
    { type: 'session/title', seq: 1, time: 1, data: { title, messageSeqs: [], source: { kind: 'fallback' } } },
  ]
  return {
    id,
    header: { parentSession: undefined },
    snapshotEvents: () => events,
  }
}

/** 装配插件 + 捕获飞书 webhook 请求。 */
async function mountFeishuHarness() {
  // 配置由 Loader 经 apply 的第二个参数交给插件（volatile 形态），不再经 settings 读取。
  const runtime = Config({
    system: { enabled: false },
    browser: { enabled: false },
    feishu: { enabled: true, webhookUrl: 'https://feishu.example/hook', verbosity: 'detailed' },
    dedup: { completedDebounceMs: 10 },
  })
  const ctx = new Context()
  apply(ctx, runtime)
  const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ code: 0, msg: 'ok' }) }))
  vi.stubGlobal('fetch', fetchMock)
  return { ctx, fetchMock }
}

/** 从捕获的飞书请求里取出卡片正文 div。 */
function capturedCardBody(fetchMock: ReturnType<typeof vi.fn>): string | undefined {
  const call = fetchMock.mock.calls[0]
  const body = JSON.parse((call?.[1] as { body?: string })?.body ?? '{}') as {
    card?: { elements?: Array<{ tag?: string; text?: { content?: string } }> }
  }
  return body.card?.elements?.find(element => element.tag === 'div')?.text?.content
}

describe('host apply 的配置接线', () => {
  it('配置来自 apply 的第二个参数（Loader 契约），不依赖 settings 服务', async () => {
    const runtime = Config({
      system: { enabled: false },
      browser: { enabled: false },
      feishu: { enabled: true, webhookUrl: 'https://feishu.example/hook', verbosity: 'detailed' },
      dedup: { completedDebounceMs: 10 },
    })
    const ctx = new Context()
    // 刻意不 provide('settings')：自身配置不需要 settings 服务
    apply(ctx, runtime)

    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ code: 0, msg: 'ok' }) }))
    vi.stubGlobal('fetch', fetchMock)
    const agent = { id: 's-plain', session: fakeSessionWithHistoricalTitle('s-plain', '标题') }
    ctx.emit('agent/status', { agent, status: 'running' } as never)
    ctx.emit('agent/status', { agent, status: 'idle' } as never)

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled())
    vi.unstubAllGlobals()
  })

  it('volatile 引用被就地更新后立即生效：关闭通道后不再投递', async () => {
    // 回归用例（SnoreToast 事故）：
    // 用户关闭 system 通道后，调度器必须立刻不再使用它。
    // 这里用 updateVolatile 复刻 Loader 提交 volatile 更新的方式（就地改引用）。
    const runtime = Config({
      system: { enabled: false },
      browser: { enabled: false },
      feishu: { enabled: true, webhookUrl: 'https://feishu.example/hook' },
      dedup: { interactionCooldownMs: 0, completedDebounceMs: 10 },
    })
    const ctx = new Context()
    apply(ctx, runtime)

    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ code: 0, msg: 'ok' }) }))
    vi.stubGlobal('fetch', fetchMock)

    const first = { id: 's-1', session: fakeSessionWithHistoricalTitle('s-1', '一') }
    ctx.emit('agent/status', { agent: first, status: 'running' } as never)
    ctx.emit('agent/status', { agent: first, status: 'idle' } as never)
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))

    // 模拟 Loader 把新配置提交进运行中的 volatile 引用（不重挂载插件）
    const updated = Config({ feishu: { enabled: false } })
    updateVolatile(runtime.feishu.enabled, updated.feishu.enabled)
    expect(runtime.feishu.enabled.get()).toBe(false)

    // 换一个会话，避开冷却；此时飞书通道应已消失 → 不应再有新请求
    const second = { id: 's-2', session: fakeSessionWithHistoricalTitle('s-2', '二') }
    ctx.emit('agent/status', { agent: second, status: 'running' } as never)
    ctx.emit('agent/status', { agent: second, status: 'idle' } as never)
    await new Promise<void>((resolve) => setTimeout(resolve, 120))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    vi.unstubAllGlobals()
  })

  it('settings 服务缺失时插件照常运行（不抛错）', async () => {
    const ctx = new Context()
    expect(() => apply(ctx, Config({}))).not.toThrow()
    await new Promise<void>((resolve) => setTimeout(resolve, 50))
  })

  it('系统通道在测试中走 node-notifier 桩，绝不投递真实通知', async () => {
    // 自检：证明 vitest 的 alias 桩确实生效。
    // 若这条失败，说明桩没挂上 —— 那么所有测试都可能真的往开发机弹 toast。
    resetDelivered()
    const runtime = Config({
      system: { enabled: true },
      browser: { enabled: false },
      feishu: { enabled: false },
      dedup: { completedDebounceMs: 10 },
    })
    const ctx = new Context()
    apply(ctx, runtime)

    const agent = { id: 's-stub', session: fakeSessionWithHistoricalTitle('s-stub', '桩检查') }
    ctx.emit('agent/status', { agent, status: 'running' } as never)
    ctx.emit('agent/status', { agent, status: 'idle' } as never)

    await vi.waitFor(() => {
      expect(delivered.some(entry => entry.message === '会话：桩检查')).toBe(true)
    })
  })
})

describe('resolveNamespace（settings 命名空间 = profile 条目原始行 id）', () => {
  it('沿 fiber 父链取 entry.options.id，而不是带 include: 前缀的复合 Entry.id', () => {
    const ctx = new Context()
    ;(ctx.fiber as unknown as { entry?: { options: { id: string } } }).entry = {
      options: { id: 'custom-entry-id' },
    }
    expect(resolveNamespace(ctx)).toBe('custom-entry-id')
  })

  it('解析不出条目时退回 messager', () => {
    const ctx = new Context()
    expect(resolveNamespace(ctx)).toBe('messager')
  })
})

describe('host apply 的会话标题兜底', () => {
  it('恢复的旧会话（历史标题不重放）：完成通知仍带会话标题', async () => {
    const { ctx, fetchMock } = await mountFeishuHarness()
    const agent = {
      id: 'session-historical',
      session: fakeSessionWithHistoricalTitle('session-historical', '历史标题'),
    }
    ctx.emit('agent/status', { agent, status: 'running' } as never)
    ctx.emit('agent/status', { agent, status: 'idle' } as never)

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(capturedCardBody(fetchMock)).toContain('会话：历史标题')
    vi.unstubAllGlobals()
  })

  it('实时标题事件到达后：完成通知带最新标题', async () => {
    const { ctx, fetchMock } = await mountFeishuHarness()
    const session = fakeSessionWithHistoricalTitle('session-live', '旧标题')
    const agent = { id: 'session-live', session }
    // 实时标题事件（如重命名）：更新内存 map 并解除无标题负缓存
    ctx.emit('session/event', session, {
      type: 'session/title', seq: 2, time: 2,
      data: { title: '新标题', messageSeqs: [], source: { kind: 'user' } },
    } as never)
    ctx.emit('agent/status', { agent, status: 'running' } as never)
    ctx.emit('agent/status', { agent, status: 'idle' } as never)

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(capturedCardBody(fetchMock)).toContain('会话：新标题')
    expect(capturedCardBody(fetchMock)).not.toContain('旧标题')
    vi.unstubAllGlobals()
  })

  it('分叉会话（header.parentSession 指向源会话、origin 为空）：完成通知正常触发', async () => {
    const { ctx, fetchMock } = await mountFeishuHarness()
    // sessions.fork 产生的会话：parentSession = 源会话 id，但 origin 为空（顶层会话）
    const session = {
      id: 'session-forked',
      header: { parentSession: 'session-source' },
      snapshotEvents: () => [],
    }
    const agent = { id: 'session-forked', session }
    ctx.emit('agent/status', { agent, status: 'running' } as never)
    ctx.emit('agent/status', { agent, status: 'idle' } as never)

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled())
    // detailed 正文至少带「打开」行；无标题事件故无「会话」行（断言不抛错即可，重点在触达）
    expect(capturedCardBody(fetchMock)).toContain('打开：')
    expect(capturedCardBody(fetchMock)).not.toContain('会话：')
    vi.unstubAllGlobals()
  })

  it('子代理会话（origin=subagent）：完成通知仍被排除', async () => {
    const { ctx, fetchMock } = await mountFeishuHarness()
    const session = {
      id: 'session-subagent',
      header: { parentSession: 'session-parent', origin: 'subagent' },
      snapshotEvents: () => [],
    }
    const agent = { id: 'session-subagent', session }
    ctx.emit('agent/status', { agent, status: 'running' } as never)
    ctx.emit('agent/status', { agent, status: 'idle' } as never)

    // 防抖 10ms；等 100ms 确认没有投递
    await new Promise<void>((resolve) => setTimeout(resolve, 100))
    expect(fetchMock).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })
})
