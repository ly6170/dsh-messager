/**
 * dsh-messager —— DeepSeek Harness 通知插件（服务端 host 端）。
 *
 * 功能：会话需要交互（审批/提问/计划待审）、任务完成、任务出错时，
 * 通过系统通知（node-notifier）、飞书机器人（webhook）推送提醒；
 * 浏览器通知由浏览器 client 端（src/client/index.ts）投递。
 *
 * 配置：Loader config（cordis.yml）注册为 settings 命名空间 `messager`
 * 的 base 层，设置页可覆盖；两者变更均热生效。
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-title'
import { resolveConfig, type Config } from './config.js'
import { interactionSignalOf, errorMessageOf, turnEndReasonOf } from './signals.js'
import { NotificationDispatcher, type NotifyChannel } from './notify.js'
import { createSystemChannel } from './channels/system.js'
import { createFeishuChannel } from './channels/feishu.js'
import { registerMessagerSettings } from './settings.js'

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
  return channels
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

  // 会话事件：会话标题、交互信号（审批/提问）、turn/end 结束原因。
  ctx.on('session/event', (session, event) => {
    if (event.type === 'session/title') {
      dispatcher.noteSessionTitle(session.id, event.data.title)
      return
    }
    const interaction = interactionSignalOf(session.id, event)
    if (interaction !== undefined) {
      dispatcher.onSignal(interaction)
      return
    }
    const turnEnd = turnEndReasonOf(event)
    if (turnEnd !== undefined) dispatcher.noteTurnEnd(session.id, turnEnd.reason)
  })

  // 运行状态：running → idle 边界触发“任务完成”；仅根会话（排除子代理噪音）。
  const running = new Map<string, boolean>()
  ctx.on('agent/status', ({ agent, status }) => {
    const isRunning = status === 'running'
    const previous = running.get(agent.id)
    running.set(agent.id, isRunning)
    if (previous !== true || isRunning) return
    if (agent.session.header.parentSession !== undefined) return
    dispatcher.onSignal({ kind: 'completed', sessionId: agent.id, seq: Date.now() })
  })

  // 错误：步骤/回合失败。
  ctx.on('agent/error', ({ agent, turn, step, error }) => {
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
