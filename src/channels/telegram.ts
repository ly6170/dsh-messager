/**
 * Telegram 通道（Bot API）：sendMessage（HTML parse_mode），host 端投递。
 *
 * 端点 = https://api.telegram.org/bot<token>/sendMessage（token 即凭证，走 URL 路径）。
 * 成功判定：HTTP 2xx 且响应 ok === true。
 * HTML parse_mode 必须转义 & < > " '，否则非法标签会导致 API 400。
 * 限制守卫：text ≤ 4096 字符。
 */

import type { NotifyChannel, NotificationPayload } from '../notify.js'

export interface TelegramChannelOptions {
  botToken: string
  /** 接收 chat_id（数字 ID 或 @频道用户名）。 */
  chatId: string
  timeoutMs: number
}

export const TELEGRAM_API_BASE = 'https://api.telegram.org'

/** HTML 转义（纯函数）：& < > " '。 */
export function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

/** sendMessage 载荷。 */
export interface TelegramSendPayload {
  chat_id: string
  text: string
  parse_mode: 'HTML'
  link_preview_options: { is_disabled: boolean }
}

/** 构建 sendMessage 载荷（纯函数；text ≤ 4096 兜底）。 */
export function buildTelegramPayload(payload: NotificationPayload, chatId: string): TelegramSendPayload {
  const lines = [`<b>${escapeHtml(payload.title)}</b>`]
  if (payload.body !== '') lines.push(escapeHtml(payload.body))
  lines.push(`<a href="${escapeHtml(payload.url)}">打开 DSH</a>`)
  return {
    chat_id: chatId,
    text: lines.join('\n').slice(0, 4096),
    parse_mode: 'HTML',
    link_preview_options: { is_disabled: true },
  }
}

export function createTelegramChannel(options: TelegramChannelOptions): NotifyChannel {
  return {
    id: 'telegram',
    async send(payload: NotificationPayload): Promise<void> {
      const endpoint = `${TELEGRAM_API_BASE}/bot${options.botToken}/sendMessage`
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(buildTelegramPayload(payload, options.chatId)),
        signal: AbortSignal.timeout(options.timeoutMs),
      })
      if (!response.ok) throw new Error(`telegram API responded ${response.status}`)
      const result = (await response.json().catch(() => undefined)) as { ok?: boolean; description?: string } | undefined
      if (result !== undefined && result.ok !== true) {
        throw new Error(`telegram rejected: ${result.description ?? 'unknown error'}`)
      }
    },
  }
}
