/**
 * 客户端会话状态 diff（纯函数，可单测）：
 * - sessionStatus.pendingInteraction 从无到有 → 需要交互（橙点）
 * - running true→false 且会话不在主视图 → 任务完成（绿点）
 */

import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionStatusSnapshot } from '@deepseek-ai/dsh-client-ui-session/client'
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
 * 对比两次列表快照。首次出现的会话只建立基线、不通知；被移除的会话不通知。
 */
export function diffSessionSummaries(
  previous: Readonly<Record<SessionId, SessionSummary>>,
  next: Readonly<Record<SessionId, SessionSummary>>,
): ClientNotice[] {
  const notices: ClientNotice[] = []
  for (const id of Object.keys(next) as SessionId[]) {
    const summary = next[id]
    if (summary === undefined) continue
    const before = previous[id]
    if (before === undefined) continue
    if (before.running && !summary.running && (summary.retainedBy.mainView ?? 0) === 0) {
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

/** 对比两次 uiSession 统一状态快照。 */
export function diffPendingInteractions(
  previous: SessionStatusSnapshot,
  next: SessionStatusSnapshot,
  summaries: Readonly<Record<SessionId, SessionSummary>>,
): ClientNotice[] {
  const notices: ClientNotice[] = []
  for (const [sessionId, status] of next) {
    const pending = status.pendingInteraction
    if (previous.get(sessionId)?.pendingInteraction !== undefined || pending === undefined) continue
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
