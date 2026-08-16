/**
 * 企业微信群机器人通道（webhook）：POST markdown 消息，host 端投递。
 *
 * 消息：msgtype=markdown，content 为「加粗标题 + 正文 + 打开链接」。
 * 可选加签（机器人「安全设置-加签」）：
 *   string_to_sign = `${timestamp}\n${secret}`
 *   sign = base64(HmacSHA256(string_to_sign, key=secret))   // 无需 URL 编码
 * 追加为查询参数 &timestamp=<ts>&sign=<sign>（与钉钉不同：钉钉需要 urlEncode）。
 * 成功判定：HTTP 2xx 且响应 errcode === 0。
 */

import { createHmac } from 'node:crypto'
import type { NotifyChannel, NotificationPayload } from '../notify.js'

export interface WecomChannelOptions {
  webhookUrl: string
  /** 加签密钥（机器人「安全设置-加签」），配置后按企业微信规范签名。 */
  secret?: string
  timeoutMs: number
}

/** 企业微信 markdown 消息载荷。 */
export interface WecomMarkdownPayload {
  msgtype: 'markdown'
  markdown: { content: string }
}

/** 构建企业微信 markdown 消息（纯函数；content 限 4000 字符兜底）。 */
export function buildWecomPayload(payload: NotificationPayload): WecomMarkdownPayload {
  const lines = [`**${payload.title}**`]
  if (payload.body !== '') lines.push(payload.body)
  lines.push(`[打开 DSH](${payload.url})`)
  return { msgtype: 'markdown', markdown: { content: lines.join('\n').slice(0, 4000) } }
}

/**
 * 企业微信加签：
 *   sign = base64(HmacSHA256(key=secret, msg=`${timestamp}\n${secret}`))，无 URL 编码。
 * @returns 追加了 timestamp/sign 查询参数的完整 URL。
 */
export function signWecomUrl(webhookUrl: string, secret: string, timestamp: string): string {
  const stringToSign = `${timestamp}\n${secret}`
  const sign = createHmac('sha256', secret).update(stringToSign).digest('base64')
  const separator = webhookUrl.includes('?') ? '&' : '?'
  return `${webhookUrl}${separator}timestamp=${timestamp}&sign=${sign}`
}

export function createWecomChannel(options: WecomChannelOptions): NotifyChannel {
  return {
    id: 'wecom',
    async send(payload: NotificationPayload): Promise<void> {
      const url = options.secret === undefined
        ? options.webhookUrl
        : signWecomUrl(options.webhookUrl, options.secret, String(Math.floor(Date.now() / 1000)))
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(buildWecomPayload(payload)),
        signal: AbortSignal.timeout(options.timeoutMs),
      })
      if (!response.ok) throw new Error(`wecom webhook responded ${response.status}`)
      const result = (await response.json().catch(() => undefined)) as { errcode?: number; errmsg?: string } | undefined
      if (result !== undefined && result.errcode !== 0) {
        throw new Error(`wecom webhook rejected: errcode=${String(result.errcode)} errmsg=${String(result.errmsg)}`)
      }
    },
  }
}
