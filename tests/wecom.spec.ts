import { describe, expect, it, vi } from 'vitest'
import { buildWecomPayload, signWecomUrl, createWecomChannel } from '../src/channels/wecom.ts'
import type { NotificationPayload } from '../src/notify.ts'

const payload: NotificationPayload = {
  kind: 'completed',
  sessionId: 's1',
  title: '任务完成',
  body: '会话：修 bug',
  url: 'http://127.0.0.1:3080',
}

describe('buildWecomPayload', () => {
  it('构建 markdown 消息：标题加粗 + 正文 + 打开链接', () => {
    const message = buildWecomPayload(payload)
    expect(message.msgtype).toBe('markdown')
    expect(message.markdown.content).toBe('**任务完成**\n会话：修 bug\n[打开 DSH](http://127.0.0.1:3080)')
  })

  it('空正文时省略正文行', () => {
    const message = buildWecomPayload({ ...payload, body: '' })
    expect(message.markdown.content).toBe('**任务完成**\n[打开 DSH](http://127.0.0.1:3080)')
  })

  it('超长 content 截断到 4000 字符（兜底守卫）', () => {
    const message = buildWecomPayload({ ...payload, title: 'T'.repeat(5000) })
    expect(message.markdown.content.length).toBeLessThanOrEqual(4000)
  })
})

describe('signWecomUrl', () => {
  it('已知答案向量：HMAC-SHA256(key=secret, msg=ts\\nsecret)，无 URL 编码', () => {
    const url = signWecomUrl('https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=k1', 'secret123', '1710000000')
    expect(url).toBe('https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=k1&timestamp=1710000000&sign=0krRsWDegtaoYNrJ6yXBZ+8rP/uqjd5oxRPoLC772TA=')
  })

  it('时间戳变化 → 签名变化', () => {
    const a = signWecomUrl('https://x/hook', 'secret123', '1710000000')
    const b = signWecomUrl('https://x/hook', 'secret123', '1710000001')
    expect(a).not.toBe(b)
  })

  it('密钥不同 → 签名不同', () => {
    const a = signWecomUrl('https://x/hook', 'secret123', '1710000000')
    const b = signWecomUrl('https://x/hook', 'other', '1710000000')
    expect(a).not.toBe(b)
  })
})

describe('createWecomChannel', () => {
  it('send：成功判定 errcode===0，无签名时用原 URL', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ errcode: 0, errmsg: 'ok' }) }))
    vi.stubGlobal('fetch', fetchMock)
    const channel = createWecomChannel({ webhookUrl: 'https://qyapi.example/send?key=k1', timeoutMs: 5000 })
    await channel.send(payload)
    const [url, init] = fetchMock.mock.calls[0] as [string, { body: string }]
    expect(url).toBe('https://qyapi.example/send?key=k1')
    expect(JSON.parse(init.body)).toMatchObject({ msgtype: 'markdown' })
    vi.unstubAllGlobals()
  })

  it('send：errcode 非 0 抛错', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ errcode: 93000, errmsg: 'invalid webhook' }) }))
    vi.stubGlobal('fetch', fetchMock)
    const channel = createWecomChannel({ webhookUrl: 'https://qyapi.example/send?key=k1', timeoutMs: 5000 })
    await expect(channel.send(payload)).rejects.toThrow(/93000/)
    vi.unstubAllGlobals()
  })

  it('send：配置密钥时 URL 携带 timestamp/sign 参数', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ errcode: 0, errmsg: 'ok' }) }))
    vi.stubGlobal('fetch', fetchMock)
    const channel = createWecomChannel({ webhookUrl: 'https://qyapi.example/send?key=k1', secret: 's', timeoutMs: 5000 })
    await channel.send(payload)
    const [url] = fetchMock.mock.calls[0] as [string]
    expect(url).toMatch(/timestamp=\d+&sign=/)
    vi.unstubAllGlobals()
  })
})
