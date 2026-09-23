/**
 * 规则/调度层：过滤（triggers）、冷却、完成防抖、通道限流，
 * 并把 Signal 渲染后分发给启用的通道。通道失败只记日志，绝不抛出。
 *
 * ⚠️ 配置与通道都在**投递时**求值（`readConfig` / `buildChannels` 注入），
 * 不缓存快照。原因见 src/index.ts 的 readConfig 说明：DSH 0.1.7 的
 * `settings/document-updated` 事件可能在 `entry.fiber.config` 提交新值**之前**触发，
 * 若在事件回调里快照配置，会永久停留在旧值（表现为「关了通知还弹」）。
 * Loader 就地更新 volatile 引用，因此「用时读取」永远是最新的。
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

/** 调度器的配置/通道来源：每次投递时求值，保证取到 volatile 引用的最新值。 */
export interface DispatcherSources {
  /** 读取当前有效配置。 */
  readConfig(): Config
  /** 依据当前配置构建启用通道（实现方自行决定是否按签名缓存）。 */
  buildChannels(config: Config): NotifyChannel[]
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
  private readonly sources: DispatcherSources
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

  constructor(options: DispatcherSources & { hooks: DispatcherHooks; now?: () => number }) {
    this.sources = { readConfig: options.readConfig, buildChannels: options.buildChannels }
    this.hooks = options.hooks
    this.now = options.now ?? Date.now
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
    const config = this.sources.readConfig()
    if (!this.triggerEnabled(signal.kind, config)) {
      this.hooks.logDebug?.(`[dispatcher] trigger disabled: ${signal.kind} ${signal.sessionId}`)
      return
    }
    if (signal.kind === 'completed') {
      this.debounceCompleted(signal, config)
      return
    }
    this.dispatchIfAllowed(signal)
  }

  private triggerEnabled(kind: TriggerKind, config: Config): boolean {
    if (kind === 'interaction') return config.triggers.interaction
    if (kind === 'completed') return config.triggers.completed
    return config.triggers.error
  }

  /** 完成信号防抖：窗口内只保留最新信号，窗口结束才投递。 */
  private debounceCompleted(signal: Signal & { kind: 'completed' }, config: Config): void {
    const sessionId = signal.sessionId
    const merged: Signal & { kind: 'completed' } = {
      ...signal,
      ...(this.lastTurnEnd.get(sessionId) === undefined ? {} : { reason: this.lastTurnEnd.get(sessionId) }),
    }
    const existing = this.pendingCompleted.get(sessionId)
    if (existing !== undefined) {
      existing.signal = merged
      clearTimeout(existing.timer)
      existing.timer = setTimeout(() => this.flushCompleted(sessionId), config.dedup.completedDebounceMs)
      return
    }
    const timer = setTimeout(() => this.flushCompleted(sessionId), config.dedup.completedDebounceMs)
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
    const config = this.sources.readConfig()
    const now = this.now()
    const key = `${signal.sessionId}:${signal.kind}`
    const last = this.cooldowns.get(key)
    if (last !== undefined && now - last < config.dedup.interactionCooldownMs) {
      this.hooks.logDebug?.(`[dispatcher] cooldown: skip ${key}`)
      return
    }
    let dispatched = false
    for (const channel of this.sources.buildChannels(config)) {
      if (!this.allowChannel(channel.id, now, config)) {
        this.hooks.logDebug?.(`[dispatcher] rate limited: ${channel.id}`)
        continue
      }
      dispatched = true
      const payload = renderPayload({
        signal,
        config,
        sessionTitle: this.titles.get(signal.sessionId),
        verbosity: this.verbosityFor(channel.id, config),
      })
      void channel.send(payload).catch((error: unknown) => {
        this.hooks.logWarn(`channel "${channel.id}" failed: ${error instanceof Error ? error.message : String(error)}`)
      })
    }
    if (dispatched) this.cooldowns.set(key, now)
  }

  /** 每通道每分钟限流。 */
  private allowChannel(channelId: string, now: number, config: Config): boolean {
    const windowStart = now - 60_000
    const window = (this.channelWindows.get(channelId) ?? []).filter(timestamp => timestamp >= windowStart)
    if (window.length >= config.dedup.perChannelPerMinute) {
      this.channelWindows.set(channelId, window)
      return false
    }
    window.push(now)
    this.channelWindows.set(channelId, window)
    return true
  }

  /** 通道 verbosity：各通道独立配置；未知通道取 normal。 */
  private verbosityFor(channelId: string, config: Config): Verbosity {
    const byId: Record<string, Verbosity> = {
      system: config.system.verbosity,
      feishu: config.feishu.verbosity,
      wecom: config.wecom.verbosity,
      discord: config.discord.verbosity,
      dingtalk: config.dingtalk.verbosity,
      telegram: config.telegram.verbosity,
    }
    return byId[channelId] ?? 'normal'
  }

  /** 清空防抖定时器（插件卸载时调用；订阅与通道本身由 effect 清理）。 */
  dispose(): void {
    for (const pending of this.pendingCompleted.values()) clearTimeout(pending.timer)
    this.pendingCompleted.clear()
  }
}
