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
import { resolveConfig, type Config } from './config.js'
import { interactionSignalOf, errorMessageOf, turnEndReasonOf } from './signals.js'
import { NotificationDispatcher, type NotifyChannel } from './notify.js'
import { createSystemChannel } from './channels/system.js'
import { createFeishuChannel } from './channels/feishu.js'
import { createWecomChannel } from './channels/wecom.js'
import { createDiscordChannel } from './channels/discord.js'
import { createDingtalkChannel } from './channels/dingtalk.js'
import { createTelegramChannel } from './channels/telegram.js'
import { registerMessagerSettings } from './settings.js'
import { mountConfigRoutes, type SettingsServiceLike } from './config-route.js'

export const name = 'dsh-messager'

/** 按当前配置构建启用的通道。 */
function buildChannels(config: Config): NotifyChannel[] {
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
  const events = session.events
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

export function apply(ctx: Context, config: Config) {
  // 配置层：settings 服务可能晚于本插件挂载，必须用 ctx.inject 动态接入；
  // 服务未就绪（如 headless profile）期间回退 Loader config 默认值。
  const dispatcher = new NotificationDispatcher({
    config: resolveConfig(config),
    channels: buildChannels(resolveConfig(config)),
    hooks: {
      logWarn: (message) => ctx.logger.warn(`[dsh-messager] ${message}`),
      logDebug: (message) => ctx.logger.debug(`[dsh-messager] ${message}`),
    },
  })

  // 配置热更新：settings 就绪后注册命名空间（base = Loader config），
  // 用户层/设置文档变更 → watch 重建通道；命名空间随注入 scope 自动卸载。
  ctx.inject(['settings'], (settingsCtx) => {
    const settings = registerMessagerSettings(settingsCtx, config)
    const effective = settings.get()
    dispatcher.reconfigure({ config: effective, channels: buildChannels(effective) })
    settingsCtx.effect(() => settings.watch((next) => {
      dispatcher.reconfigure({ config: next, channels: buildChannels(next) })
    }), 'dsh-messager: settings watch')
  })

  // 配置读写路由（webServer 通道）：浏览器端经此读写 messager 命名空间，
  // 不受 Web 设置白名单门控（dsh-market 同款「正门」）。仅 Web 环境挂载；
  // headless profile 无 webServer 服务时本 inject 不执行，不影响通知功能。
  ctx.inject(['webServer'], (webCtx) => {
    webCtx.inject(['settings'], (fullCtx) => {
      const settingsService = fullCtx.get('settings')
      if (settingsService === undefined) return
      const disposeRoutes = mountConfigRoutes(
        fullCtx.webServer,
        settingsService as unknown as SettingsServiceLike,
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
