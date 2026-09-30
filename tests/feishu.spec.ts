import { describe, expect, it } from 'vitest'
import { buildCardPayload, signFeishuPayload } from '../src/channels/feishu.ts'
import type { NotificationPayload } from '../src/notify.ts'

const payload: NotificationPayload = {
  kind: 'completed',
  sessionId: 's1',
  title: '任务完成',
  body: '会话：修 bug',
}

describe('buildCardPayload', () => {
  it('构建 interactive 卡片：标题/模板色/正文', () => {
    const card = buildCardPayload(payload)
    expect(card.msg_type).toBe('interactive')
    expect(card.card.header.title.content).toBe('任务完成')
    expect(card.card.header.template).toBe('green')
    expect(card.card.elements).toHaveLength(1)
    expect(card.card.elements[0]).toMatchObject({ tag: 'div', text: { content: '会话：修 bug' } })
  })

  it('不带任何跳转按钮/链接（v0.3.6 起第三方推送不含跳转链接）', () => {
    const json = JSON.stringify(buildCardPayload(payload))
    expect(json).not.toContain('"action"')
    expect(json).not.toMatch(/https?:\/\//)
    expect(json).not.toContain('打开 DSH')
  })

  it('模板色按触发类型：interaction 橙 / error 红', () => {
    expect(buildCardPayload({ ...payload, kind: 'interaction' }).card.header.template).toBe('orange')
    expect(buildCardPayload({ ...payload, kind: 'error' }).card.header.template).toBe('red')
  })

  it('空正文时正文退化为标题（卡片始终有正文元素）', () => {
    const card = buildCardPayload({ ...payload, body: '' })
    expect(card.card.elements).toHaveLength(1)
    expect(card.card.elements[0]!.text.content).toBe('任务完成')
  })
})

describe('signFeishuPayload', () => {
  it('HMAC-SHA256 签名（已知答案向量）', () => {
    const signed = signFeishuPayload({ msg_type: 'interactive' }, 'secret123', '1710000000')
    expect(signed.timestamp).toBe('1710000000')
    expect(signed.sign).toBe('m8T5+E8oYezfUIUMyYeLIzZ+IgJYAVAP7YeywqR/Nck=')
    expect(signed.msg_type).toBe('interactive')
  })

  it('时间戳变化 → 签名变化', () => {
    const a = signFeishuPayload({}, 'secret123', '1710000000')
    const b = signFeishuPayload({}, 'secret123', '1710000001')
    expect(a.sign).not.toBe(b.sign)
  })

  it('密钥不同 → 签名不同', () => {
    const a = signFeishuPayload({}, 'secret123', '1710000000')
    const b = signFeishuPayload({}, 'other', '1710000000')
    expect(a.sign).not.toBe(b.sign)
  })
})
