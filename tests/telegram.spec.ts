import { describe, expect, it, vi } from 'vitest'
import { buildTelegramPayload, escapeHtml, createTelegramChannel, TELEGRAM_API_BASE } from '../src/channels/telegram.ts'
import type { NotificationPayload } from '../src/notify.ts'

const payload: NotificationPayload = {
  kind: 'completed',
  sessionId: 's1',
  title: '任务完成',
  body: '会话：修 bug',
  url: 'http://127.0.0.1:3080',
}

describe('escapeHtml', () => {
  it('转义 & < > " \'', () => {
    expect(escapeHtml('a&b<c>d"e\'f')).toBe('a&amp;b&lt;c&gt;d&quot;e&#39;f')
  })
})

describe('buildTelegramPayload', () => {
  it('构建 sendMessage：HTML 标题 + 正文 + 链接，chat_id 透传', () => {
    const message = buildTelegramPayload(payload, '123456')
    expect(message.chat_id).toBe('123456')
    expect(message.parse_mode).toBe('HTML')
    expect(message.link_preview_options).toEqual({ is_disabled: true })
    expect(message.text).toBe('<b>任务完成</b>\n会话：修 bug\n<a href="http://127.0.0.1:3080">打开 DSH</a>')
  })

  it('错误消息中的特殊字符被转义（防 parse_mode 400）', () => {
    const message = buildTelegramPayload({ ...payload, title: 'a<b>&c', body: 'x"y' }, '123456')
    expect(message.text).toContain('<b>a&lt;b&gt;&amp;c</b>')
    expect(message.text).toContain('x&quot;y')
  })

  it('空正文时省略正文行', () => {
    const message = buildTelegramPayload({ ...payload, body: '' }, '123456')
    expect(message.text).toBe('<b>任务完成</b>\n<a href="http://127.0.0.1:3080">打开 DSH</a>')
  })

  it('text 截断到 4096（兜底守卫）', () => {
    const message = buildTelegramPayload({ ...payload, body: 'B'.repeat(5000) }, '123456')
    expect(message.text.length).toBeLessThanOrEqual(4096)
  })
})

describe('createTelegramChannel', () => {
  it('send：端点带 bot token，成功判定 ok===true', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, result: { message_id: 1 } }) }))
    vi.stubGlobal('fetch', fetchMock)
    const channel = createTelegramChannel({ botToken: '123:ABC', chatId: '123456', timeoutMs: 5000 })
    await expect(channel.send(payload)).resolves.toBeUndefined()
    const [url, init] = fetchMock.mock.calls[0] as [string, { body: string }]
    expect(url).toBe(`${TELEGRAM_API_BASE}/bot123:ABC/sendMessage`)
    expect(JSON.parse(init.body)).toMatchObject({ chat_id: '123456', parse_mode: 'HTML' })
    vi.unstubAllGlobals()
  })

  it('send：ok=false 抛错并带 description', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ ok: false, description: 'chat not found' }) }))
    vi.stubGlobal('fetch', fetchMock)
    const channel = createTelegramChannel({ botToken: '123:ABC', chatId: '999', timeoutMs: 5000 })
    await expect(channel.send(payload)).rejects.toThrow(/chat not found/)
    vi.unstubAllGlobals()
  })

  it('send：非 2xx 抛错', async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) }))
    vi.stubGlobal('fetch', fetchMock)
    const channel = createTelegramChannel({ botToken: '123:ABC', chatId: '123456', timeoutMs: 5000 })
    await expect(channel.send(payload)).rejects.toThrow(/401/)
    vi.unstubAllGlobals()
  })
})
