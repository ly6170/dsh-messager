/**
 * 钉钉自定义机器人通道（webhook）：actionCard 卡片（标题 + markdown 正文 + 打开按钮），host 端投递。
 *
 * 可选加签（机器人「安全设置-加签」）：
 *   string_to_sign = `${timestamp}\n${secret}`
 *   sign = urlEncode(base64(HmacSHA256(string_to_sign, key=secret)))   // 必须 URL 编码
 * 追加为查询参数 &timestamp=<ts>&sign=<sign>（与企微不同：企微不需要 urlEncode）。
 * 成功判定：HTTP 2xx 且响应 errcode === 0。
 * 注意：actionCard 的 title 限 20 字符，超出会被平台拒绝，需截断。
 */

import { createHmac } from 'node:crypto'
import type { NotifyChannel, NotificationPayload } from '../notify.js'

export interface DingtalkChannelOptions {
  webhookUrl: string
  /** 加签密钥（机器人「安全设置-加签」），配置后按钉钉规范签名。 */
  secret?: string
  timeoutMs: number
}

/** 钉钉 actionCard 载荷。 */
export interface DingtalkActionCardPayload {
  msgtype: 'actionCard'
  actionCard: {
    title: string
    text: string
    btnOrientation: '0'
    singleTitle: string
    singleURL: string
  }
}

/** 构建钉钉 actionCard 载荷（纯函数；title 限 20 字符；正文空时退化为链接）。 */
export function buildDingtalkPayload(payload: NotificationPayload): DingtalkActionCardPayload {
  const link = `[打开 DSH](${payload.url})`
  return {
    msgtype: 'actionCard',
    actionCard: {
      title: payload.title.slice(0, 20),
      text: payload.body === '' ? link : `${payload.body}\n\n${link}`,
      btnOrientation: '0',
      singleTitle: '打开 DSH',
      singleURL: payload.url,
    },
  }
}

/**
 * 钉钉加签：
 *   sign = urlEncode(base64(HmacSHA256(key=secret, msg=`${timestamp}\n${secret}`)))
 * @returns 追加了 timestamp/sign（URL 编码后）查询参数的完整 URL。
 */
export function signDingtalkUrl(webhookUrl: string, secret: string, timestamp: string): string {
  const stringToSign = `${timestamp}\n${secret}`
  const sign = createHmac('sha256', secret).update(stringToSign).digest('base64')
  const encoded = encodeURIComponent(sign)
  const separator = webhookUrl.includes('?') ? '&' : '?'
  return `${webhookUrl}${separator}timestamp=${timestamp}&sign=${encoded}`
}

export function createDingtalkChannel(options: DingtalkChannelOptions): NotifyChannel {
  return {
    id: 'dingtalk',
    async send(payload: NotificationPayload): Promise<void> {
      const url = options.secret === undefined
        ? options.webhookUrl
        : signDingtalkUrl(options.webhookUrl, options.secret, String(Math.floor(Date.now() / 1000)))
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(buildDingtalkPayload(payload)),
        signal: AbortSignal.timeout(options.timeoutMs),
      })
      if (!response.ok) throw new Error(`dingtalk webhook responded ${response.status}`)
      const result = (await response.json().catch(() => undefined)) as { errcode?: number; errmsg?: string } | undefined
      if (result !== undefined && result.errcode !== 0) {
        throw new Error(`dingtalk webhook rejected: errcode=${String(result.errcode)} errmsg=${String(result.errmsg)}`)
      }
    },
  }
}
