/**
 * dsh-messager —— DeepSeek Harness 通知插件（服务端 host 端）。
 *
 * 功能：会话需要交互（审批/提问/计划待审）、任务完成、任务出错时，
 * 通过系统通知（node-notifier）、飞书/企业微信/Discord/钉钉/Telegram
 * 第三方通道推送提醒；浏览器通知由浏览器 client 端（src/client/index.ts）投递。
 *
 * 配置：Loader config（cordis.yml）注册为 settings 命名空间 `messager`
 * 的 base 层，设置页可覆盖；两者变更均热生效。
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type { Session } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-title'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { resolveConfig, type Config as ConfigShape, type RuntimeConfig } from './config.js'
import { interactionSignalOf, errorMessageOf, turnEndReasonOf } from './signals.js'
import { NotificationDispatcher, type NotifyChannel } from './notify.js'
import { createSystemChannel } from './channels/system.js'
import { createFeishuChannel } from './channels/feishu.js'
import { createWecomChannel } from './channels/wecom.js'
import { createDiscordChannel } from './channels/discord.js'
import { createDingtalkChannel } from './channels/dingtalk.js'
import { createTelegramChannel } from './channels/telegram.js'
import { resolveNamespace } from './settings.js'
import { mountConfigRoutes, type SettingsServiceLike } from './config-route.js'

export const name = 'dsh-messager'

/**
 * ⚠️ 必须从**入口模块**导出 `Config` schema。
 *
 * DSH 0.1.7 由 Loader 直接读取插件模块的 `Config` 导出作为 settings 表单 schema
 * （`entry.fiber.runtime.Config`，见 packages/settings/settings/src/index.ts 的
 * `schema(entry)`）。schema 只在 src/config.ts 定义、入口不导出的话，
 * `describe()` 会直接跳过本条目 —— 表现为设置页/配置路由一律 `unavailable`，
 * 且没有任何报错。这是 0.1.7 的硬契约。
 */
export { Config } from './config.js'

/**
 * 通道构建结果的缓存签名：只覆盖**影响通道构造**的字段。
 *
 * `buildChannels` 会做图标存在性校验（同步 fs）等一次性工作，因此按签名缓存；
 * verbosity 不影响构造（投递时才读），故不纳入。
 * ⚠️ 新增通道/字段时必须同步补这里，否则改了配置不会重建通道。
 */
function channelSignature(config: ConfigShape): string {
  return JSON.stringify([
    config.system.enabled, config.system.icon,
    config.feishu.enabled, config.feishu.webhookUrl, config.feishu.secret, config.feishu.timeoutMs,
    config.wecom.enabled, config.wecom.webhookUrl, config.wecom.secret, config.wecom.timeoutMs,
    config.discord.enabled, config.discord.webhookUrl, config.discord.timeoutMs,
    config.dingtalk.enabled, config.dingtalk.webhookUrl, config.dingtalk.secret, config.dingtalk.timeoutMs,
    config.telegram.enabled, config.telegram.botToken, config.telegram.chatId, config.telegram.timeoutMs,
  ])
}

/** 按当前配置构建启用的通道。 */
function buildChannels(config: ConfigShape): NotifyChannel[] {
  const channels: NotifyChannel[] = []
  if (config.system.enabled) {
    channels.push(createSystemChannel({
      ...(config.system.icon === undefined ? {} : { icon: config.system.icon }),
    }))
  }
  if (config.feishu.enabled && config.feishu.webhookUrl !== undefined) {
    channels.push(createFeishuChannel({
      webhookUrl: config.feishu.webhookUrl,
      ...(config.feishu.secret === undefined ? {} : { secret: config.feishu.secret }),
      timeoutMs: config.feishu.timeoutMs,
    }))
  }
  if (config.wecom.enabled && config.wecom.webhookUrl !== undefined) {
    channels.push(createWecomChannel({
      webhookUrl: config.wecom.webhookUrl,
      ...(config.wecom.secret === undefined ? {} : { secret: config.wecom.secret }),
      timeoutMs: config.wecom.timeoutMs,
    }))
  }
  if (config.discord.enabled && config.discord.webhookUrl !== undefined) {
    channels.push(createDiscordChannel({
      webhookUrl: config.discord.webhookUrl,
      timeoutMs: config.discord.timeoutMs,
    }))
  }
  if (config.dingtalk.enabled && config.dingtalk.webhookUrl !== undefined) {
    channels.push(createDingtalkChannel({
      webhookUrl: config.dingtalk.webhookUrl,
      ...(config.dingtalk.secret === undefined ? {} : { secret: config.dingtalk.secret }),
      timeoutMs: config.dingtalk.timeoutMs,
    }))
  }
  if (config.telegram.enabled && config.telegram.botToken !== undefined && config.telegram.chatId !== undefined) {
    channels.push(createTelegramChannel({
      botToken: config.telegram.botToken,
      chatId: config.telegram.chatId,
      timeoutMs: config.telegram.timeoutMs,
    }))
  }
  return channels
}

/**
 * 从会话事件日志取最近的非空标题。会话日志包含持久化重放的历史事件
 * （含 session/title），因此进程重启后恢复的会话也能取到标题 ——
 * 实时 session/event 只在事件发生时投递一次，不会重放历史。
 */
function sessionTitleOf(session: Session): string | undefined {
  const events = session.snapshotEvents()
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index]
    if (event === undefined) continue
    if (event.type !== 'session/title') continue
    if (event.data.title === '') continue
    return event.data.title
  }
  return undefined
}

/** 已扫描过日志且确认无标题的会话（避免对无标题会话反复全量扫描大日志）。 */
const noTitleSessions = new Set<string>()

/** 标题兜底：实时 map 缺失时从会话日志补取一次；新标题事件到达时解除负缓存。 */
function ensureSessionTitle(dispatcher: NotificationDispatcher, session: Session): void {
  const sessionId = session.id
  if (dispatcher.hasTitle(sessionId)) return
  if (noTitleSessions.has(sessionId)) return
  const title = sessionTitleOf(session)
  if (title === undefined) {
    noTitleSessions.add(sessionId)
    return
  }
  dispatcher.noteSessionTitle(sessionId, title)
}

/**
 * 插件入口。
 *
 * @param ctx - 插件上下文。
 * @param config - Loader 传入的运行时配置：可编辑字段是 volatile 引用
 *   （`.volatile()` 的输出形态，见 src/config.ts），由 `resolveConfig` 取值。
 */
export function apply(ctx: Context, config: RuntimeConfig) {
  /**
   * 读取当前有效配置。
   *
   * ⚠️ 关键：**每次用时读取 volatile 引用**，绝不缓存配置快照。
   *
   * DSH 0.1.7 的 `settings/document-updated` 事件在 `describe()` 内部、
   * `entry.fiber.config` 提交新值**之前**触发（见 settings/index.ts 的 describe()：
   * 先 emit，后 `projectForm(form, plainConfig(entry.fiber.config))`）。因此在事件
   * 回调里快照配置会读到**旧值**，而 `raw` 已更新 → 不会再有第二次事件 →
   * 调度器永久停留在旧配置。这正是「已关闭系统通知却仍弹 SnoreToast」的根因。
   *
   * Loader 会**就地更新** volatile 引用（`Entry._commitVolatile`），所以这里
   * 每次调用都能拿到最新值 —— 这也是 DSH 官方插件（如 pwsh-local）的惯例用法。
   */
  const readConfig = (): ConfigShape => resolveConfig(config)

  /** 按签名缓存的通道构建（配置变化时自动重建）。 */
  let channelCache: { signature: string; channels: NotifyChannel[] } | undefined
  const channelsFor = (current: ConfigShape): NotifyChannel[] => {
    const signature = channelSignature(current)
    if (channelCache?.signature !== signature) {
      channelCache = { signature, channels: buildChannels(current) }
    }
    return channelCache.channels
  }

  const dispatcher = new NotificationDispatcher({
    readConfig,
    buildChannels: channelsFor,
    hooks: {
      logWarn: (message) => ctx.logger.warn(`[dsh-messager] ${message}`),
      logDebug: (message) => ctx.logger.debug(`[dsh-messager] ${message}`),
    },
  })

  // 配置读写路由（webServer 通道）：浏览器端经此读写本插件命名空间，
  // 不受 Web 设置白名单门控（dsh-market 同款「正门」）。仅 Web 环境挂载；
  // headless profile 无 webServer 服务时本 inject 不执行，不影响通知功能。
  //
  // 注意：本插件的**自身配置**不需要 settings 服务 —— Loader 已把 volatile 引用
  // 交给我们并就地更新（见 readConfig）。settings 只用于这条浏览器读写路由。
  ctx.inject(['webServer'], (webCtx) => {
    webCtx.inject(['settings'], (fullCtx) => {
      const settingsService = fullCtx.get('settings')
      if (settingsService === undefined) return
      const disposeRoutes = mountConfigRoutes(
        fullCtx.webServer,
        settingsService as unknown as SettingsServiceLike,
        resolveNamespace(fullCtx),
      )
      fullCtx.effect(() => disposeRoutes, 'dsh-messager: config routes')
    })
  })

  // 会话事件：会话标题、交互信号（审批/提问）、turn/end 结束原因。
  ctx.on('session/event', (session, event) => {
    if (event.type === 'session/title') {
      noTitleSessions.delete(session.id) // 新标题到达：解除无标题负缓存
      dispatcher.noteSessionTitle(session.id, event.data.title)
      return
    }
    const interaction = interactionSignalOf(session.id, event)
    if (interaction !== undefined) {
      ensureSessionTitle(dispatcher, session)
      dispatcher.onSignal(interaction)
      return
    }
    const turnEnd = turnEndReasonOf(event)
    if (turnEnd !== undefined) dispatcher.noteTurnEnd(session.id, turnEnd.reason)
  })

  // 运行状态：running → idle 边界触发“任务完成”；仅根会话（排除子代理噪音）。
  // 注意：子代理判别必须用 origin === 'subagent'，不能用 parentSession ——
  // 分叉会话（sessions.fork）的 header 也会携带 parentSession（指向源会话），
  // 但 origin 为空，仍是顶层会话，任务完成后应正常通知。
  const running = new Map<string, boolean>()
  ctx.on('agent/status', ({ agent, status }) => {
    const isRunning = status === 'running'
    const previous = running.get(agent.id)
    running.set(agent.id, isRunning)
    if (previous !== true || isRunning) return
    if (agent.session.header.origin === 'subagent') return
    ensureSessionTitle(dispatcher, agent.session)
    dispatcher.onSignal({ kind: 'completed', sessionId: agent.id, seq: Date.now() })
  })

  // 错误：步骤/回合失败。
  ctx.on('agent/error', ({ agent, turn, step, error }) => {
    ensureSessionTitle(dispatcher, agent.session)
    dispatcher.onSignal({
      kind: 'error',
      sessionId: agent.id,
      message: errorMessageOf(error),
      turn,
      step,
      seq: Date.now(),
    })
  })

  ctx.effect(() => () => dispatcher.dispose(), 'dsh-messager: dispatcher timers')
  ctx.logger.info('[dsh-messager] plugin loaded')
}
