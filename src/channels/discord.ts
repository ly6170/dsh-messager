/**
 * Discord 通道（webhook）：embed 卡片（标题/正文/链接 + kind 颜色），host 端投递。
 *
 * 成功判定：任意 2xx（Discord 通常返回 204 No Content，无 body 可解析，
 * 因此与飞书/企微/钉钉的 errcode 判定不同，不解析响应 JSON）。
 * 限制守卫：title ≤ 256、description ≤ 4096（超限会被 Discord 400 拒绝）。
 */

import type { NotifyChannel, NotificationPayload } from '../notify.js'

export interface DiscordChannelOptions {
  webhookUrl: string
  timeoutMs: number
}

/** kind → embed 颜色（interaction 橙 / completed 绿 / error 红）。 */
export function embedColorOf(kind: NotificationPayload['kind']): number {
  switch (kind) {
    case 'interaction': return 0xE67E22
    case 'completed': return 0x2ECC71
    case 'error': return 0xE74C3C
  }
}

/** Discord webhook 载荷（embed 单卡片）。 */
export interface DiscordEmbedPayload {
  username: string
  embeds: Array<{
    title: string
    description?: string
    url: string
    color: number
  }>
}

/** 构建 Discord embed 载荷（纯函数；title ≤ 256、description ≤ 4096）。 */
export function buildDiscordPayload(payload: NotificationPayload): DiscordEmbedPayload {
  return {
    username: 'DSH',
    embeds: [{
      title: payload.title.slice(0, 256),
      ...(payload.body === '' ? {} : { description: payload.body.slice(0, 4096) }),
      url: payload.url,
      color: embedColorOf(payload.kind),
    }],
  }
}

export function createDiscordChannel(options: DiscordChannelOptions): NotifyChannel {
  return {
    id: 'discord',
    async send(payload: NotificationPayload): Promise<void> {
      const response = await fetch(options.webhookUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(buildDiscordPayload(payload)),
        signal: AbortSignal.timeout(options.timeoutMs),
      })
      if (!response.ok) throw new Error(`discord webhook responded ${response.status}`)
      // 204 No Content：成功即返回，不读取 body
    },
  }
}
