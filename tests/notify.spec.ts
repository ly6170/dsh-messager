import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveConfig, type Config } from '../src/config.ts'
import { NotificationDispatcher, type NotificationPayload, type NotifyChannel } from '../src/notify.ts'
import type { Signal } from '../src/signals.ts'

/** 记录收到的载荷的假通道。 */
function fakeChannel(id: string): NotifyChannel & { received: NotificationPayload[]; fail: boolean } {
  const state = { received: [] as NotificationPayload[], fail: false }
  return {
    id,
    get received() {
      return state.received
    },
    get fail() {
      return state.fail
    },
    set fail(value: boolean) {
      state.fail = value
    },
    async send(payload: NotificationPayload) {
      if (state.fail) throw new Error(`channel ${id} exploded`)
      state.received.push(payload)
    },
  }
}

function baseConfig(overrides: Partial<Config> = {}): Config {
  return resolveConfig(overrides)
}

const interactionSignal: Signal = {
  kind: 'interaction', sessionId: 's1', interaction: 'approval', toolName: 'bash', seq: 1,
}
const completedSignal: Signal = { kind: 'completed', sessionId: 's1', seq: 2 }
const errorSignal: Signal = { kind: 'error', sessionId: 's1', message: 'boom', seq: 3 }

describe('NotificationDispatcher', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('interaction 立即投递到所有通道', async () => {
    const a = fakeChannel('system')
    const b = fakeChannel('feishu')
    const dispatcher = new NotificationDispatcher({
      config: baseConfig(),
      channels: [a, b],
      hooks: { logWarn: () => undefined },
    })
    dispatcher.onSignal(interactionSignal)
    await Promise.resolve()
    expect(a.received).toHaveLength(1)
    expect(b.received).toHaveLength(1)
    expect(a.received[0]?.title).toBe('需要交互：等待审批')
  })

  it('同会话同触发冷却期内不重复投递', async () => {
    const channel = fakeChannel('system')
    const dispatcher = new NotificationDispatcher({
      config: baseConfig(),
      channels: [channel],
      hooks: { logWarn: () => undefined },
    })
    dispatcher.onSignal(interactionSignal)
    dispatcher.onSignal({ ...interactionSignal, seq: 2 })
    await Promise.resolve()
    expect(channel.received).toHaveLength(1)

    vi.advanceTimersByTime(11_000)
    dispatcher.onSignal({ ...interactionSignal, seq: 3 })
    await Promise.resolve()
    expect(channel.received).toHaveLength(2)
  })

  it('completed 防抖：窗口内合并为一次投递，并带上 turn/end 原因', async () => {
    const channel = fakeChannel('system')
    const dispatcher = new NotificationDispatcher({
      config: baseConfig(),
      channels: [channel],
      hooks: { logWarn: () => undefined },
    })
    dispatcher.onSignal(completedSignal)
    dispatcher.onSignal({ ...completedSignal, seq: 5 })
    dispatcher.noteTurnEnd('s1', { kind: 'aborted', reason: 'user' })
    expect(channel.received).toHaveLength(0)
    vi.advanceTimersByTime(1_100)
    await Promise.resolve()
    expect(channel.received).toHaveLength(1)
    expect(channel.received[0]?.title).toBe('任务中止')
  })

  it('completed 触发被禁用时不投递', async () => {
    const channel = fakeChannel('system')
    const dispatcher = new NotificationDispatcher({
      config: baseConfig({ triggers: { interaction: true, completed: false, error: true } }),
      channels: [channel],
      hooks: { logWarn: () => undefined },
    })
    dispatcher.onSignal(completedSignal)
    vi.advanceTimersByTime(2_000)
    await Promise.resolve()
    expect(channel.received).toHaveLength(0)
  })

  it('每通道每分钟限流', async () => {
    const channel = fakeChannel('system')
    const dispatcher = new NotificationDispatcher({
      config: baseConfig({ dedup: { interactionCooldownMs: 0, completedDebounceMs: 1000, perChannelPerMinute: 2 } }),
      channels: [channel],
      hooks: { logWarn: () => undefined },
    })
    for (let i = 0; i < 5; i += 1) {
      dispatcher.onSignal({ ...interactionSignal, sessionId: `s${i}`, seq: i })
    }
    await Promise.resolve()
    expect(channel.received).toHaveLength(2)
  })

  it('通道失败只记日志不抛出', async () => {
    const channel = fakeChannel('system')
    channel.fail = true
    const warns: string[] = []
    const dispatcher = new NotificationDispatcher({
      config: baseConfig(),
      channels: [channel],
      hooks: { logWarn: (message) => warns.push(message) },
    })
    dispatcher.onSignal(errorSignal)
    await Promise.resolve()
    await Promise.resolve()
    expect(warns).toHaveLength(1)
    expect(warns[0]).toContain('channel "system" failed')
  })

  it('reconfigure 热替换配置与通道', async () => {
    const oldChannel = fakeChannel('system')
    const newChannel = fakeChannel('system')
    const dispatcher = new NotificationDispatcher({
      config: baseConfig(),
      channels: [oldChannel],
      hooks: { logWarn: () => undefined },
    })
    dispatcher.reconfigure({ config: baseConfig({ message: { titlePrefix: '[X]' } }), channels: [newChannel] })
    dispatcher.onSignal(interactionSignal)
    await Promise.resolve()
    expect(oldChannel.received).toHaveLength(0)
    expect(newChannel.received).toHaveLength(1)
    expect(newChannel.received[0]?.title).toBe('[X] 需要交互：等待审批')
  })

  it('会话标题参与渲染（normal 繁复度）', async () => {
    const channel = fakeChannel('system')
    const dispatcher = new NotificationDispatcher({
      config: baseConfig(),
      channels: [channel],
      hooks: { logWarn: () => undefined },
    })
    dispatcher.noteSessionTitle('s1', '修 bug')
    dispatcher.onSignal(interactionSignal)
    await Promise.resolve()
    expect(channel.received[0]?.body).toContain('会话：修 bug')
  })

  it('dispose 清理防抖定时器', () => {
    const channel = fakeChannel('system')
    const dispatcher = new NotificationDispatcher({
      config: baseConfig(),
      channels: [channel],
      hooks: { logWarn: () => undefined },
    })
    dispatcher.onSignal(completedSignal)
    dispatcher.dispose()
    vi.advanceTimersByTime(5_000)
    expect(channel.received).toHaveLength(0)
  })
})
