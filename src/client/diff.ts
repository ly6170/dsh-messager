/**
 * 客户端会话状态 diff（纯函数，可单测）：
 * - sessionStatus.pendingInteraction 从无到有 → 需要交互（橙点）
 * - running true→false 且会话不在主视图 → 任务完成（绿点）
 * - `api-session/error`（宿主转发事件）→ 任务出错
 */

import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionStatusSnapshot } from '@deepseek-ai/dsh-client-ui-session/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

export type ClientNoticeKind = 'interaction' | 'completed' | 'error'
export type ClientInteractionKind = 'approval' | 'plan-review' | 'question'

export interface ClientNotice {
  kind: ClientNoticeKind
  sessionId: SessionId
  /** interaction 细分（与 PendingInteractionStatus 一致）。 */
  interaction?: ClientInteractionKind
  /** 会话显示标题（displayTitle）。 */
  title?: string
  /** error 的错误摘要（来自 `api-session/error` 的第二个参数）。 */
  message?: string
}

/**
 * 对比两次列表快照。首次出现的会话只建立基线、不通知；被移除的会话不通知。
 *
 * @param options.ignoreMainView - 忽略「会话是否正被主视图持有」这条过滤（v0.3.6 起）：
 *   窗口/minimized 到后台（用户没在看）时，**当前打开的那个会话**完成了也应该提醒 ——
 *   否则「跑一个任务、切走」这个最常见用法永远收不到完成通知。
 *   页面可见但仍要通知（`onlyWhenHidden=false`）时保持过滤：那时用户正看着它。
 */
export function diffSessionSummaries(
  previous: Readonly<Record<SessionId, SessionSummary>>,
  next: Readonly<Record<SessionId, SessionSummary>>,
  options: { ignoreMainView?: boolean } = {},
): ClientNotice[] {
  const ignoreMainView = options.ignoreMainView === true
  const notices: ClientNotice[] = []
  for (const id of Object.keys(next) as SessionId[]) {
    const summary = next[id]
    if (summary === undefined) continue
    const before = previous[id]
    if (before === undefined) continue
    if (before.running && !summary.running
      && (ignoreMainView || (summary.retainedBy.mainView ?? 0) === 0)) {
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
 * 触发开关门控：与 host 端 `triggers` 语义对齐。
 *
 * 此前浏览器通道完全没有这层判断，导致「关闭某类触发」对浏览器通知无效 ——
 * 用户关掉后仍会收到（Windows 把浏览器通知渲染成系统 toast，难以分辨来源）。
 */
export function triggerAllows(
  notice: ClientNotice,
  triggers: { interaction: boolean; completed: boolean; error: boolean },
): boolean {
  switch (notice.kind) {
    case 'interaction': return triggers.interaction
    case 'completed': return triggers.completed
    case 'error': return triggers.error
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

/**
 * `api-session/error`（宿主 `agent/error` 的客户端转发事件）→ 任务出错通知。
 *
 * 会话标题从当前列表摘要里取；取不到就只发错误摘要。
 * 桌面版默认只用渲染端通道，这条是「关掉 system 通道后仍能收到错误提醒」的前提。
 */
export function errorNotice(
  sessionId: SessionId,
  message: string,
  summaries: Readonly<Record<SessionId, SessionSummary>>,
): ClientNotice {
  const title = summaries[sessionId]?.displayTitle
  return {
    kind: 'error',
    sessionId,
    message,
    ...(title === undefined ? {} : { title }),
  }
}
