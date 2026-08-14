/**
 * 信号层：把 DSH 事件（session/event、agent/status、agent/error）翻译为
 * 统一的通知信号（Signal）。提取逻辑为纯函数，便于单元测试。
 */

import type { SessionEvent, TurnEndReason } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-user-approval'

export type { TurnEndReason } from '@deepseek-ai/dsh-session'

/** 触发类型（对应配置 triggers.*）。 */
export type TriggerKind = 'interaction' | 'completed' | 'error'

/** 交互类型：审批（approval/asked）或提问/计划待审（ask_user_question 工具）。 */
export type InteractionKind = 'approval' | 'question'

/** 统一内部信号（调度层输入）。 */
export type Signal =
  | {
    kind: 'interaction'
    sessionId: string
    interaction: InteractionKind
    toolName?: string
    reason?: string
    turn?: number
    step?: number
    seq: number
  }
  | {
    kind: 'completed'
    sessionId: string
    /** 最近一次 turn/end 的原因（由调度层合并）。 */
    reason?: TurnEndReason
    turn?: number
    step?: number
    seq: number
  }
  | {
    kind: 'error'
    sessionId: string
    message: string
    turn?: number
    step?: number
    seq: number
  }

/** ask_user_question 工具的稳定名称（提问/计划待审均经由该工具发起）。 */
export const ASK_USER_QUESTION_TOOL = 'ask_user_question'

/**
 * 从一条会话事件中提取“需要交互”信号：
 * - `approval/asked`（落库审计事件）→ 审批
 * - `tool/call` 且工具名为 ask_user_question → 提问/计划待审
 *
 * @returns 交互信号；该事件与交互无关时返回 undefined。
 */
export function interactionSignalOf(sessionId: string, event: SessionEvent): Signal | undefined {
  if (event.type === 'approval/asked') {
    return {
      kind: 'interaction',
      sessionId,
      interaction: 'approval',
      ...(event.data.toolName === undefined ? {} : { toolName: event.data.toolName }),
      ...(event.data.reason === undefined ? {} : { reason: event.data.reason }),
      seq: event.seq,
    }
  }
  if (event.type === 'tool/call' && event.data.name === ASK_USER_QUESTION_TOOL) {
    return {
      kind: 'interaction',
      sessionId,
      interaction: 'question',
      toolName: event.data.name,
      turn: event.data.turn,
      step: event.data.step,
      seq: event.seq,
    }
  }
  return undefined
}

/**
 * 从一条会话事件中提取 turn/end 的结束原因。
 * @returns { turn, reason }；非 turn/end 事件返回 undefined。
 */
export function turnEndReasonOf(event: SessionEvent): { turn: number; reason: TurnEndReason } | undefined {
  if (event.type !== 'turn/end') return undefined
  return { turn: event.data.turn, reason: event.data.reason }
}
/** 把未知错误归一化为可展示的字符串（截断防刷屏）。 */
export function errorMessageOf(error: unknown, maxLength = 300): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.length > maxLength ? `${message.slice(0, maxLength)}…` : message
}
