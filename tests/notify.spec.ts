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

/**
 * 构造调度器。配置/通道以**闭包**形式提供，与生产接线（src/index.ts）同构；
 * 测试里传固定值即可，需要验证「用时求值」的用例传可变引用。
 */
function makeDispatcher(options: {
  readConfig?: () => Config
  buildChannels?: (config: Config) => NotifyChannel[]
  channels?: NotifyChannel[]
  hooks?: { logWarn(message: string): void; logDebug?(message: string): void }
  now?: () => number
} = {}): NotificationDispatcher {
  const fixedChannels = options.channels ?? []
  return new NotificationDispatcher({
    readConfig: options.readConfig ?? (() => baseConfig()),
    buildChannels: options.buildChannels ?? (() => fixedChannels),
    hooks: options.hooks ?? { logWarn: () => undefined },
    ...(options.now === undefined ? {} : { now: options.now }),
  })
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
    const dispatcher = makeDispatcher({ channels: [a, b] })
    dispatcher.onSignal(interactionSignal)
    await Promise.resolve()
    expect(a.received).toHaveLength(1)
    expect(b.received).toHaveLength(1)
    expect(a.received[0]?.title).toBe('需要交互：等待审批')
  })

  it('同会话同触发冷却期内不重复投递', async () => {
    const channel = fakeChannel('system')
    const dispatcher = makeDispatcher({ channels: [channel] })
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
    const dispatcher = makeDispatcher({ channels: [channel] })
    dispatcher.onSignal(completedSignal)
    dispatcher.onSignal({ ...completedSignal, seq: 5 })
    dispatcher.noteTurnEnd('s1', { kind: 'aborted', reason: { kind: 'user' } })
    expect(channel.received).toHaveLength(0)
    vi.advanceTimersByTime(1_100)
    await Promise.resolve()
    expect(channel.received).toHaveLength(1)
    expect(channel.received[0]?.title).toBe('任务中止')
  })

  it('completed 触发被禁用时不投递', async () => {
    const channel = fakeChannel('system')
    const dispatcher = makeDispatcher({
      readConfig: () => baseConfig({ triggers: { interaction: true, completed: false, error: true } }),
      channels: [channel],
    })
    dispatcher.onSignal(completedSignal)
    vi.advanceTimersByTime(2_000)
    await Promise.resolve()
    expect(channel.received).toHaveLength(0)
  })

  it('每通道每分钟限流', async () => {
    const channel = fakeChannel('system')
    const dispatcher = makeDispatcher({
      readConfig: () => baseConfig({
        dedup: { interactionCooldownMs: 0, completedDebounceMs: 1000, perChannelPerMinute: 2 },
      }),
      channels: [channel],
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
    const dispatcher = makeDispatcher({
      channels: [channel],
      hooks: { logWarn: (message) => warns.push(message) },
    })
    dispatcher.onSignal(errorSignal)
    await Promise.resolve()
    await Promise.resolve()
    expect(warns).toHaveLength(1)
    expect(warns[0]).toContain('channel "system" failed')
  })

  it('配置在投递时求值：读到的是最新值，不是构造时的快照', async () => {
    // 回归用例：DSH 的 settings/document-updated 事件可能早于 fiber 提交新值，
    // 若调度器缓存配置快照，用户「关闭通知」后仍会继续投递（SnoreToast 事故）。
    const channel = fakeChannel('system')
    let config = baseConfig()
    const dispatcher = makeDispatcher({ readConfig: () => config, channels: [channel] })

    dispatcher.onSignal(interactionSignal)
    await Promise.resolve()
    expect(channel.received).toHaveLength(1)

    // 用户关闭 interaction 触发（模拟 volatile 引用被就地更新）
    config = baseConfig({ triggers: { interaction: false, completed: true, error: true } })
    vi.advanceTimersByTime(11_000)
    dispatcher.onSignal({ ...interactionSignal, sessionId: 's2', seq: 9 })
    await Promise.resolve()
    expect(channel.received).toHaveLength(1) // 没有新增
  })

  it('通道在投递时按当前配置重建：enabled 变化立即生效', async () => {
    // 回归用例：用户关闭 system 通道后，不得再向该通道投递。
    const system = fakeChannel('system')
    let systemEnabled = true
    const dispatcher = makeDispatcher({
      buildChannels: () => (systemEnabled ? [system] : []),
    })

    dispatcher.onSignal(interactionSignal)
    await Promise.resolve()
    expect(system.received).toHaveLength(1)

    systemEnabled = false
    vi.advanceTimersByTime(11_000)
    dispatcher.onSignal({ ...interactionSignal, sessionId: 's2', seq: 9 })
    await Promise.resolve()
    expect(system.received).toHaveLength(1) // 没有新增
  })

  it('会话标题参与渲染（normal 繁复度）', async () => {
    const channel = fakeChannel('system')
    const dispatcher = makeDispatcher({ channels: [channel] })
    dispatcher.noteSessionTitle('s1', '修 bug')
    dispatcher.onSignal(interactionSignal)
    await Promise.resolve()
    expect(channel.received[0]?.body).toContain('会话：修 bug')
  })

  it('dispose 清理防抖定时器', () => {
    const channel = fakeChannel('system')
    const dispatcher = makeDispatcher({ channels: [channel] })
    dispatcher.onSignal(completedSignal)
    dispatcher.dispose()
    vi.advanceTimersByTime(5_000)
    expect(channel.received).toHaveLength(0)
  })
})
