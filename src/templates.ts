/**
 * 消息模板层：把 Signal 渲染为各通道的最终载荷（NotificationPayload）。
 * 纯函数；verbosity（内容繁复度）按通道取值：
 * - minimal：只有标题
 * - normal：+ 会话标题 / 工具名 / 结束原因 / 错误摘要
 * - detailed：+ turn/step 与 GUI 链接
 */

import type { Config, Verbosity } from './config.ts'
import type { Signal, TurnEndReason } from './signals.ts'

/** 投递给通道的最终通知载荷（已渲染）。 */
export interface NotificationPayload {
  kind: Signal['kind']
  sessionId: string
  title: string
  body: string
  /** 打开 DSH 的地址（system 通道点击 / 飞书卡片按钮）。 */
  url: string
}

/** 渲染上下文。 */
export interface RenderContext {
  signal: Signal
  config: Config
  /** 会话标题（来自 session/title 事件），可为空。 */
  sessionTitle?: string
  verbosity: Verbosity
}

const KIND_TITLES: Record<Signal['kind'], string> = {
  interaction: '需要交互',
  completed: '任务完成',
  error: '任务出错',
}

/** 交互类型的细分标题。 */
function interactionTitle(kind: 'approval' | 'question'): string {
  return kind === 'approval' ? '需要交互：等待审批' : '需要交互：等待回答'
}

/** 完成原因 → 标题与正文细节（DSH 的 TurnEndReason 为可扩展 sum 类型）。 */
export function completionLabelOf(reason: TurnEndReason): { title: string; detail?: string } {
  switch (reason.kind) {
    case 'completed': return { title: '任务完成' }
    case 'aborted': return { title: '任务中止', detail: '任务被中止' }
    case 'blocked': return { title: '任务受阻', detail: '任务被阻塞' }
    case 'error': return { title: '任务失败', detail: '任务执行出错' }
    case 'max-tokens': return { title: '输出达上限', detail: '达到输出 token 上限' }
    case 'interrupted': return { title: '任务中断', detail: '任务被中断' }
    default: return { title: '任务完成' }
  }
}

/** 标题（不含前缀）：completed 依据结束原因细分。 */
export function baseTitleOf(signal: Signal): string {
  if (signal.kind === 'interaction') return interactionTitle(signal.interaction)
  if (signal.kind === 'completed') {
    return signal.reason === undefined ? '任务完成' : completionLabelOf(signal.reason).title
  }
  return KIND_TITLES.error
}

/** 完整标题（含可选前缀）。 */
export function titleOf(ctx: RenderContext): string {
  const base = baseTitleOf(ctx.signal)
  const prefix = ctx.config.message.titlePrefix
  return prefix === undefined || prefix === '' ? base : `${prefix} ${base}`
}

function sessionTitleLine(ctx: RenderContext): string | undefined {
  if (!ctx.config.message.includeSessionTitle) return undefined
  const title = ctx.sessionTitle
  if (title === undefined || title === '') return undefined
  return `会话：${title}`
}

function turnLine(ctx: RenderContext): string | undefined {
  const { turn, step } = ctx.signal
  if (turn === undefined) return undefined
  return step === undefined ? `turn ${turn}` : `turn ${turn} / step ${step}`
}

/** 正文（verbosity 决定繁复度）。 */
export function bodyOf(ctx: RenderContext): string {
  const lines: string[] = []
  const { signal } = ctx
  if (ctx.verbosity === 'minimal') return ''

  // normal 与 detailed 共有的内容
  if (signal.kind === 'interaction') {
    if (signal.interaction === 'approval') {
      lines.push(`等待审批：${signal.toolName ?? '未知工具'}`)
    } else {
      lines.push('等待回答（提问/计划待审）')
    }
  } else if (signal.kind === 'completed') {
    if (signal.reason !== undefined) {
      const detail = completionLabelOf(signal.reason).detail
      if (detail !== undefined) lines.push(detail)
    }
  } else {
    lines.push(`错误：${signal.message}`)
  }
  const sessionLine = sessionTitleLine(ctx)
  if (sessionLine !== undefined) lines.push(sessionLine)

  if (ctx.verbosity === 'detailed') {
    const turn = turnLine(ctx)
    if (turn !== undefined) lines.push(turn)
    if (signal.kind === 'interaction' && signal.reason !== undefined) {
      lines.push(`原因：${signal.reason}`)
    }
    lines.push(`打开：${ctx.config.message.guiUrl}`)
  }
  return lines.join('\n')
}

/** 渲染完整载荷。 */
export function renderPayload(ctx: RenderContext): NotificationPayload {
  return {
    kind: ctx.signal.kind,
    sessionId: ctx.signal.sessionId,
    title: titleOf(ctx),
    body: bodyOf(ctx),
    url: ctx.config.message.guiUrl,
  }
}
