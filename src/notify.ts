/**
 * 规则/调度层：过滤（triggers）、冷却、完成防抖、通道限流，
 * 并把 Signal 渲染后分发给启用的通道。通道失败只记日志，绝不抛出。
 */

import type { Config, Verbosity } from './config.ts'
import { renderPayload, type NotificationPayload } from './templates.js'
import type { Signal, TriggerKind, TurnEndReason } from './signals.js'

/** 通知载荷由模板层产出，通道层从此处取类型。 */
export type { NotificationPayload } from './templates.js'

/** 通知通道接口：系统（node-notifier）/ 飞书（webhook）/ 浏览器（client 端）皆实现此接口。 */
export interface NotifyChannel {
  readonly id: string
  send(payload: NotificationPayload): Promise<void>
}

/** 调度器外部钩子（日志）。 */
export interface DispatcherHooks {
  logWarn(message: string): void
  logDebug?(message: string): void
}

/** 通道配置更新（settings watch 回调时整体替换）。 */
export interface DispatcherConfig {
  config: Config
  channels: NotifyChannel[]
}

interface PendingCompleted {
  signal: Signal & { kind: 'completed' }
  timer: ReturnType<typeof setTimeout>
}

/**
 * 通知调度器：
 * - `onSignal`：interaction/error 即时投递；completed 进入防抖窗口
 *   （等待 turn/end 合并结束原因，并折叠窗口内的重复边界）；
 * - 冷却：同一会话同一触发在 `interactionCooldownMs` 内只投递一次；
 * - 限流：每通道每分钟不超过 `perChannelPerMinute` 条。
 */
export class NotificationDispatcher {
  private config: Config
  private readonly channels: NotifyChannel[]
  private readonly hooks: DispatcherHooks
  private readonly now: () => number

  /** sessionId → 会话标题（来自 session/title 事件）。 */
  private readonly titles = new Map<string, string>()
  /** sessionId → 最近一次 turn/end 原因。 */
  private readonly lastTurnEnd = new Map<string, TurnEndReason>()
  /** `${sessionId}:${kind}` → 上次投递时间戳。 */
  private readonly cooldowns = new Map<string, number>()
  /** sessionId → 防抖中的完成信号与定时器。 */
  private readonly pendingCompleted = new Map<string, PendingCompleted>()
  /** channelId → 最近一分钟内的投递时间戳。 */
  private readonly channelWindows = new Map<string, number[]>()

  constructor(options: DispatcherConfig & { hooks: DispatcherHooks; now?: () => number }) {
    this.config = options.config
    this.channels = options.channels
    this.hooks = options.hooks
    this.now = options.now ?? Date.now
  }

  /** 配置热更新（settings watch）：替换配置与通道，保留标题/冷却等状态。 */
  reconfigure(next: DispatcherConfig): void {
    this.config = next.config
    this.channels.splice(0, this.channels.length, ...next.channels)
  }

  /** 记录会话标题（session/title 事件）。 */
  noteSessionTitle(sessionId: string, title: string): void {
    if (title === '') return
    this.titles.set(sessionId, title)
  }

  /** 是否已记录该会话的标题（缺失时插件可从会话事件日志兜底补取）。 */
  hasTitle(sessionId: string): boolean {
    return this.titles.has(sessionId)
  }

  /** 记录 turn/end 结束原因，并合并到正在防抖的完成信号上。 */
  noteTurnEnd(sessionId: string, reason: TurnEndReason): void {
    this.lastTurnEnd.set(sessionId, reason)
    const pending = this.pendingCompleted.get(sessionId)
    if (pending !== undefined && pending.signal.reason === undefined) {
      pending.signal = { ...pending.signal, reason }
    }
  }

  /** 信号入口：interaction/error 立即处理；completed 进入防抖。 */
  onSignal(signal: Signal): void {
    if (!this.triggerEnabled(signal.kind)) {
      this.hooks.logDebug?.(`[dispatcher] trigger disabled: ${signal.kind} ${signal.sessionId}`)
      return
    }
    if (signal.kind === 'completed') {
      this.debounceCompleted(signal)
      return
    }
    this.dispatchIfAllowed(signal)
  }

  private triggerEnabled(kind: TriggerKind): boolean {
    if (kind === 'interaction') return this.config.triggers.interaction
    if (kind === 'completed') return this.config.triggers.completed
    return this.config.triggers.error
  }

  /** 完成信号防抖：窗口内只保留最新信号，窗口结束才投递。 */
  private debounceCompleted(signal: Signal & { kind: 'completed' }): void {
    const sessionId = signal.sessionId
    const merged: Signal & { kind: 'completed' } = {
      ...signal,
      ...(this.lastTurnEnd.get(sessionId) === undefined ? {} : { reason: this.lastTurnEnd.get(sessionId) }),
    }
    const existing = this.pendingCompleted.get(sessionId)
    if (existing !== undefined) {
      existing.signal = merged
      clearTimeout(existing.timer)
      existing.timer = setTimeout(() => this.flushCompleted(sessionId), this.config.dedup.completedDebounceMs)
      return
    }
    const timer = setTimeout(() => this.flushCompleted(sessionId), this.config.dedup.completedDebounceMs)
    this.pendingCompleted.set(sessionId, { signal: merged, timer })
  }

  /** 防抖窗口结束：投递（若仍满足冷却）。 */
  flushCompleted(sessionId: string): void {
    const pending = this.pendingCompleted.get(sessionId)
    if (pending === undefined) return
    this.pendingCompleted.delete(sessionId)
    this.dispatchIfAllowed(pending.signal)
  }

  /** 冷却检查 + 逐通道渲染 + 分发。 */
  private dispatchIfAllowed(signal: Signal): void {
    const now = this.now()
    const key = `${signal.sessionId}:${signal.kind}`
    const last = this.cooldowns.get(key)
    if (last !== undefined && now - last < this.config.dedup.interactionCooldownMs) {
      this.hooks.logDebug?.(`[dispatcher] cooldown: skip ${key}`)
      return
    }
    let dispatched = false
    for (const channel of this.channels) {
      if (!this.allowChannel(channel.id, now)) {
        this.hooks.logDebug?.(`[dispatcher] rate limited: ${channel.id}`)
        continue
      }
      dispatched = true
      const payload = renderPayload({
        signal,
        config: this.config,
        sessionTitle: this.titles.get(signal.sessionId),
        verbosity: this.verbosityFor(channel.id),
      })
      void channel.send(payload).catch((error: unknown) => {
        this.hooks.logWarn(`channel "${channel.id}" failed: ${error instanceof Error ? error.message : String(error)}`)
      })
    }
    if (dispatched) this.cooldowns.set(key, now)
  }

  /** 每通道每分钟限流。 */
  private allowChannel(channelId: string, now: number): boolean {
    const windowStart = now - 60_000
    const window = (this.channelWindows.get(channelId) ?? []).filter(timestamp => timestamp >= windowStart)
    if (window.length >= this.config.dedup.perChannelPerMinute) {
      this.channelWindows.set(channelId, window)
      return false
    }
    window.push(now)
    this.channelWindows.set(channelId, window)
    return true
  }

  /** 通道 verbosity：system/feishu 各自配置；未知通道取 normal。 */
  private verbosityFor(channelId: string): Verbosity {
    switch (channelId) {
      case 'system': return this.config.system.verbosity
      case 'feishu': return this.config.feishu.verbosity
      default: return 'normal'
    }
  }

  /** 清空防抖定时器（插件卸载时调用；订阅与通道本身由 effect 清理）。 */
  dispose(): void {
    for (const pending of this.pendingCompleted.values()) clearTimeout(pending.timer)
    this.pendingCompleted.clear()
  }
}
