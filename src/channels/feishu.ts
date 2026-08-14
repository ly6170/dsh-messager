/**
 * 飞书机器人（webhook）通道：自定义机器人 webhook，interactive 卡片。
 * 配置 secret 时按飞书规范签名（HMAC-SHA256，timestamp + sign 字段）。
 * 纯函数（buildCardPayload / signFeishuPayload）可单测。
 */

import { createHmac } from 'node:crypto'
import type { NotifyChannel, NotificationPayload } from '../notify.js'

export interface FeishuChannelOptions {
  webhookUrl: string
  /** 签名密钥（飞书“安全设置-签名校验”）。 */
  secret?: string
  timeoutMs: number
}

/** 卡片模板色：completed 绿 / interaction 橙 / error 红。 */
function cardTemplateOf(kind: NotificationPayload['kind']): 'green' | 'orange' | 'red' {
  switch (kind) {
    case 'interaction': return 'orange'
    case 'completed': return 'green'
    case 'error': return 'red'
  }
}

/** 飞书 interactive 卡片载荷（未签名）。 */
export interface FeishuCardPayload {
  msg_type: 'interactive'
  card: {
    header: { title: { tag: 'plain_text'; content: string }; template: 'green' | 'orange' | 'red' }
    elements: (
      | { tag: 'div'; text: { tag: 'lark_md'; content: string } }
      | { tag: 'action'; actions: Array<{ tag: 'button'; text: { tag: 'plain_text'; content: string }; url: string; type: 'primary' }> }
    )[]
  }
}

/** 构建飞书卡片（纯函数）。 */
export function buildCardPayload(payload: NotificationPayload): FeishuCardPayload {
  return {
    msg_type: 'interactive',
    card: {
      header: {
        title: { tag: 'plain_text', content: payload.title },
        template: cardTemplateOf(payload.kind),
      },
      elements: [
        ...(payload.body === ''
          ? []
          : [{ tag: 'div' as const, text: { tag: 'lark_md' as const, content: payload.body } }]),
        {
          tag: 'action',
          actions: [{
            tag: 'button',
            text: { tag: 'plain_text', content: '打开 DSH' },
            url: payload.url,
            type: 'primary',
          }],
        },
      ],
    },
  }
}

/**
 * 按飞书签名规范签名：
 *   string_to_sign = `${timestamp}\n${secret}`，sign = base64(HMAC-SHA256(string_to_sign, ""))
 * @param payload - 原始请求体。
 * @param secret - 机器人签名密钥。
 * @param timestamp - 秒级时间戳。
 */
export function signFeishuPayload<T extends object>(
  payload: T,
  secret: string,
  timestamp: string,
): T & { timestamp: string; sign: string } {
  const stringToSign = `${timestamp}\n${secret}`
  const sign = createHmac('sha256', stringToSign).update('').digest('base64')
  return { ...payload, timestamp, sign }
}

export function createFeishuChannel(options: FeishuChannelOptions): NotifyChannel {
  return {
    id: 'feishu',
    async send(payload: NotificationPayload): Promise<void> {
      const card = buildCardPayload(payload)
      const body = options.secret === undefined
        ? card
        : signFeishuPayload(card, options.secret, String(Math.floor(Date.now() / 1000)))
      const response = await fetch(options.webhookUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(options.timeoutMs),
      })
      if (!response.ok) {
        throw new Error(`feishu webhook responded ${response.status}`)
      }
      const result = (await response.json().catch(() => undefined)) as { code?: number; msg?: string } | undefined
      if (result !== undefined && result.code !== 0) {
        throw new Error(`feishu webhook rejected: code=${String(result.code)} msg=${String(result.msg)}`)
      }
    },
  }
}
