/**
 * 客户端会话摘要 diff（纯函数，可单测）：
 * 对比两次会话列表快照，产出需要浏览器通知的变化。
 * 语义与 Web UI 状态圆点完全一致：
 * - uiSession.pendingInteractions 从无到有 → 需要交互（橙点）
 * - running true→false 且会话非当前选中 → 任务完成（绿点）
 */

import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionPendingInteractionBase } from '@deepseek-ai/dsh-client-ui-session/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

export type ClientNoticeKind = 'interaction' | 'completed'
export type ClientInteractionKind = 'approval' | 'plan-review' | 'question'

export interface ClientNotice {
  kind: ClientNoticeKind
  sessionId: SessionId
  /** interaction 细分（与 PendingInteractionStatus 一致）。 */
  interaction?: ClientInteractionKind
  /** 会话显示标题（displayTitle）。 */
  title?: string
}

/**
 * 对比两次列表快照。
 * 首次出现的会话只建立基线、不通知；被移除的会话不通知。
 * @param previous - 上一次快照的 byId。
 * @param next - 本次快照的 byId。
 * @param current - 本次快照的当前选中会话（选中会话的完成不打扰）。
 */
export function diffSessionSummaries(
  previous: Readonly<Record<SessionId, SessionSummary>>,
  next: Readonly<Record<SessionId, SessionSummary>>,
  current: SessionId | undefined,
): ClientNotice[] {
  const notices: ClientNotice[] = []
  for (const id of Object.keys(next) as SessionId[]) {
    const summary = next[id]
    if (summary === undefined) continue
    const before = previous[id]
    if (before === undefined) continue // 首次出现：只建立基线
    if (before.running && !summary.running && id !== current) {
      notices.push({ kind: 'completed', sessionId: id, title: summary.displayTitle })
    }
  }
  return notices
}

/** 仅把 DSH Web UI 有专用展示语义的待交互 kind 映射为通知类型。 */
export function clientInteractionKindOf(kind: string): ClientInteractionKind | undefined {
  switch (kind) {
    case 'approval':
    case 'plan-review':
    case 'question':
      return kind
    default:
      return undefined
  }
}

/**
 * 对比两次 uiSession 待交互快照。
 * 仅从无到有时通知；首次订阅由调用方把当前快照设为 previous，因此不会补发历史通知。
 */
export function diffPendingInteractions(
  previous: ReadonlyMap<SessionId, SessionPendingInteractionBase>,
  next: ReadonlyMap<SessionId, SessionPendingInteractionBase>,
  summaries: Readonly<Record<SessionId, SessionSummary>>,
): ClientNotice[] {
  const notices: ClientNotice[] = []
  for (const [sessionId, pending] of next) {
    if (previous.has(sessionId)) continue
    const interaction = clientInteractionKindOf(pending.kind)
    if (interaction === undefined) continue
    const title = summaries[sessionId]?.displayTitle
    notices.push({
      kind: 'interaction',
      sessionId,
      interaction,
      ...(title === undefined ? {} : { title }),
    })
  }
  return notices
}
