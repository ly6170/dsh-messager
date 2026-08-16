import { describe, expect, it, vi } from 'vitest'
import { buildDiscordPayload, embedColorOf, createDiscordChannel } from '../src/channels/discord.ts'
import type { NotificationPayload } from '../src/notify.ts'

const payload: NotificationPayload = {
  kind: 'completed',
  sessionId: 's1',
  title: '任务完成',
  body: '会话：修 bug',
  url: 'http://127.0.0.1:3080',
}

describe('buildDiscordPayload', () => {
  it('构建 embed：username/标题/正文/链接/颜色', () => {
    const message = buildDiscordPayload(payload)
    expect(message.username).toBe('DSH')
    expect(message.embeds).toHaveLength(1)
    expect(message.embeds[0]).toMatchObject({
      title: '任务完成',
      description: '会话：修 bug',
      url: 'http://127.0.0.1:3080',
      color: 0x2ECC71,
    })
  })

  it('空正文时省略 description 字段', () => {
    const message = buildDiscordPayload({ ...payload, body: '' })
    expect(message.embeds[0]).not.toHaveProperty('description')
  })

  it('kind → 颜色：interaction 橙 / completed 绿 / error 红', () => {
    expect(embedColorOf('interaction')).toBe(0xE67E22)
    expect(embedColorOf('completed')).toBe(0x2ECC71)
    expect(embedColorOf('error')).toBe(0xE74C3C)
    expect(buildDiscordPayload({ ...payload, kind: 'interaction' }).embeds[0]!.color).toBe(0xE67E22)
    expect(buildDiscordPayload({ ...payload, kind: 'error' }).embeds[0]!.color).toBe(0xE74C3C)
  })

  it('截断守卫：title ≤ 256、description ≤ 4096', () => {
    const message = buildDiscordPayload({ ...payload, title: 'T'.repeat(300), body: 'B'.repeat(5000) })
    expect(message.embeds[0]!.title.length).toBe(256)
    expect(message.embeds[0]!.description!.length).toBe(4096)
  })
})

describe('createDiscordChannel', () => {
  it('send：204 No Content 视为成功（不解析 body）', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 204, json: async () => { throw new Error('no body') } }))
    vi.stubGlobal('fetch', fetchMock)
    const channel = createDiscordChannel({ webhookUrl: 'https://discord.com/api/webhooks/1/abc', timeoutMs: 5000 })
    await expect(channel.send(payload)).resolves.toBeUndefined()
    const [, init] = fetchMock.mock.calls[0] as [string, { body: string }]
    expect(JSON.parse(init.body)).toMatchObject({ username: 'DSH', embeds: [{ title: '任务完成' }] })
    vi.unstubAllGlobals()
  })

  it('send：非 2xx 抛错', async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 400, json: async () => ({}) }))
    vi.stubGlobal('fetch', fetchMock)
    const channel = createDiscordChannel({ webhookUrl: 'https://discord.com/api/webhooks/1/abc', timeoutMs: 5000 })
    await expect(channel.send(payload)).rejects.toThrow(/400/)
    vi.unstubAllGlobals()
  })
})
