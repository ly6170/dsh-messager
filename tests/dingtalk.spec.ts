import { describe, expect, it, vi } from 'vitest'
import { buildDingtalkPayload, signDingtalkUrl, createDingtalkChannel } from '../src/channels/dingtalk.ts'
import type { NotificationPayload } from '../src/notify.ts'

const payload: NotificationPayload = {
  kind: 'completed',
  sessionId: 's1',
  title: '任务完成',
  body: '会话：修 bug',
  url: 'http://127.0.0.1:3080',
}

describe('buildDingtalkPayload', () => {
  it('构建 actionCard：标题/正文含链接/打开按钮', () => {
    const card = buildDingtalkPayload(payload)
    expect(card.msgtype).toBe('actionCard')
    expect(card.actionCard).toMatchObject({
      title: '任务完成',
      btnOrientation: '0',
      singleTitle: '打开 DSH',
      singleURL: 'http://127.0.0.1:3080',
    })
    expect(card.actionCard.text).toBe('会话：修 bug\n\n[打开 DSH](http://127.0.0.1:3080)')
  })

  it('空正文时 text 退化为 markdown 链接', () => {
    const card = buildDingtalkPayload({ ...payload, body: '' })
    expect(card.actionCard.text).toBe('[打开 DSH](http://127.0.0.1:3080)')
  })

  it('title 截断到 20 字符（钉钉 actionCard 限制）', () => {
    const card = buildDingtalkPayload({ ...payload, title: '超'.repeat(30) })
    expect(card.actionCard.title.length).toBe(20)
  })
})

describe('signDingtalkUrl', () => {
  it('已知答案向量：HMAC-SHA256(key=secret, msg=ts\\nsecret) + URL 编码（+、/、= 均被编码）', () => {
    const url = signDingtalkUrl('https://oapi.dingtalk.com/robot/send?access_token=t1', 'secret123', '1710000000')
    expect(url).toBe('https://oapi.dingtalk.com/robot/send?access_token=t1&timestamp=1710000000&sign=0krRsWDegtaoYNrJ6yXBZ%2B8rP%2Fuqjd5oxRPoLC772TA%3D')
  })

  it('时间戳变化 → 签名变化', () => {
    const a = signDingtalkUrl('https://x/hook', 'secret123', '1710000000')
    const b = signDingtalkUrl('https://x/hook', 'secret123', '1710000001')
    expect(a).not.toBe(b)
  })

  it('密钥不同 → 签名不同', () => {
    const a = signDingtalkUrl('https://x/hook', 'secret123', '1710000000')
    const b = signDingtalkUrl('https://x/hook', 'other', '1710000000')
    expect(a).not.toBe(b)
  })
})

describe('createDingtalkChannel', () => {
  it('send：成功判定 errcode===0，无签名时用原 URL', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ errcode: 0, errmsg: 'ok' }) }))
    vi.stubGlobal('fetch', fetchMock)
    const channel = createDingtalkChannel({ webhookUrl: 'https://oapi.example/robot/send?access_token=t1', timeoutMs: 5000 })
    await channel.send(payload)
    const [url, init] = fetchMock.mock.calls[0] as [string, { body: string }]
    expect(url).toBe('https://oapi.example/robot/send?access_token=t1')
    expect(JSON.parse(init.body)).toMatchObject({ msgtype: 'actionCard' })
    vi.unstubAllGlobals()
  })

  it('send：errcode 非 0 抛错', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ errcode: 310000, errmsg: 'invalid token' }) }))
    vi.stubGlobal('fetch', fetchMock)
    const channel = createDingtalkChannel({ webhookUrl: 'https://oapi.example/robot/send?access_token=t1', timeoutMs: 5000 })
    await expect(channel.send(payload)).rejects.toThrow(/310000/)
    vi.unstubAllGlobals()
  })

  it('send：配置密钥时 URL 携带 timestamp 与 URL 编码后的 sign', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ errcode: 0, errmsg: 'ok' }) }))
    vi.stubGlobal('fetch', fetchMock)
    const channel = createDingtalkChannel({ webhookUrl: 'https://oapi.example/robot/send?access_token=t1', secret: 's', timeoutMs: 5000 })
    await channel.send(payload)
    const [url] = fetchMock.mock.calls[0] as [string]
    const parsed = new URL(url)
    expect(parsed.searchParams.get('timestamp')).toMatch(/\d+/)
    // URLSearchParams.get 返回解码后的值（%2B → +），编码痕迹需在原始 URL 字符串上断言
    expect(parsed.searchParams.get('sign')).toBeTruthy()
    expect(url).toContain('%')
    vi.unstubAllGlobals()
  })
})
