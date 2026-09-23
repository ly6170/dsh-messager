import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { apply } from '../src/index.ts'
import { resolveConfig } from '../src/config.ts'

/**
 * 假 settings 服务：0.1.7 契约下命名空间 = profile 条目 id，
 * 插件不再「注册」schema，而是经 describe() 读取本条目（ns）的有效值。
 */
function fakeSettingsService(value: unknown = {}, ns = 'messager') {
  const describeCalls: Array<{ redactSecrets?: boolean } | undefined> = []
  const service = {
    writable: true,
    describe(options?: { redactSecrets?: boolean }) {
      describeCalls.push(options)
      return [{ ns, value, revision: 0 }]
    },
  }
  return { service, describeCalls }
}

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

/** 装配插件 + 假 settings + 捕获飞书 webhook 请求。 */
async function mountFeishuHarness() {
  const config = resolveConfig({
    system: { enabled: false },
    browser: { enabled: false },
    feishu: { enabled: true, webhookUrl: 'https://feishu.example/hook', verbosity: 'detailed' },
    dedup: { completedDebounceMs: 10 },
  })
  const ctx = new Context()
  const { service } = fakeSettingsService(config)
  ctx.provide('settings', service)
  apply(ctx, {} as never)
  // 等 settings inject 子 fiber 完成读取与通道重建（dispatcher 此时才持有飞书通道）
  await new Promise<void>((resolve) => setTimeout(resolve, 50))
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

describe('host apply 的 settings 接线', () => {
  it('settings 服务可用时按条目 id 读取 messager 命名空间（脱敏视图）', async () => {
    const ctx = new Context()
    const { service, describeCalls } = fakeSettingsService({ feishu: { enabled: true } })
    ctx.provide('settings', service)

    apply(ctx, {} as never)
    // 等 inject 子 fiber 启动并完成读取
    await new Promise<void>((resolve) => setTimeout(resolve, 100))

    expect(describeCalls.length).toBeGreaterThan(0)
    // 必须走脱敏读取：secret 字段的值永不进入 host 侧配置对象
    expect(describeCalls[0]?.redactSecrets).toBe(true)
  })

  it('条目 id 由 fiber 解析（不硬编码 messager）', async () => {
    const ctx = new Context()
    // describe 只认 custom-entry-id；若插件硬编码 'messager' 就读不到 → 通道不建
    let describeCount = 0
    const custom = {
      writable: true,
      describe: () => {
        describeCount += 1
        return [{
          ns: 'custom-entry-id',
          value: {
            feishu: { enabled: true, webhookUrl: 'https://feishu.example/hook' },
            dedup: { completedDebounceMs: 10 },
          },
          revision: 0,
        }]
      },
    }
    ctx.provide('settings', custom)
    // Loader 会在插件 fiber 上挂载所属条目；settings 命名空间取原始行 id
    // （options.id），不是带 include: 前缀的复合 Entry.id
    ;(ctx.fiber as unknown as { entry?: { options: { id: string } } }).entry = {
      options: { id: 'custom-entry-id' },
    }

    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ code: 0, msg: 'ok' }) }))
    vi.stubGlobal('fetch', fetchMock)
    apply(ctx, {} as never)
    await new Promise<void>((resolve) => setTimeout(resolve, 50))

    const agent = { id: 'session-ns', session: fakeSessionWithHistoricalTitle('session-ns', '标题') }
    ctx.emit('agent/status', { agent, status: 'running' } as never)
    ctx.emit('agent/status', { agent, status: 'idle' } as never)

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(describeCount).toBeGreaterThan(0)
    vi.unstubAllGlobals()
  })

  it('settings 服务缺失时插件照常运行（回退默认配置，不抛错）', async () => {
    const ctx = new Context()
    expect(() => apply(ctx, {} as never)).not.toThrow()
    await new Promise<void>((resolve) => setTimeout(resolve, 50))
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
