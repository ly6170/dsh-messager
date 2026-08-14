/**
 * 客户端会话摘要 diff（纯函数，可单测）：
 * 对比两次会话列表快照，产出需要浏览器通知的变化。
 * 语义与 Web UI 状态圆点完全一致：
 * - pendingInteraction 从无到有 → 需要交互（橙点）
 * - running true→false 且会话非当前选中 → 任务完成（绿点）
 */

import type { SessionId, SessionSummary } from '@deepseek-ai/dsh-client-runtime/client'

export type ClientNoticeKind = 'interaction' | 'completed'

export interface ClientNotice {
  kind: ClientNoticeKind
  sessionId: SessionId
  /** interaction 细分（与 PendingInteractionStatus 一致）。 */
  interaction?: 'approval' | 'plan-review' | 'question'
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
    if (summary.pendingInteraction !== undefined && before.pendingInteraction === undefined) {
      notices.push({
        kind: 'interaction',
        sessionId: id,
        interaction: summary.pendingInteraction,
        title: summary.displayTitle,
      })
    }
    if (before.running && !summary.running && id !== current) {
      notices.push({ kind: 'completed', sessionId: id, title: summary.displayTitle })
    }
  }
  return notices
}
