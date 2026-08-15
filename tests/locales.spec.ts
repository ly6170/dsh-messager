import { describe, expect, it } from 'vitest'
import { zh, en } from '../src/client/locales.ts'
import { CARD_FIELDS } from '../src/client/card-controller.ts'
import { GROUP_TITLE_KEYS } from '../src/client/settings-form.tsx'

describe('locale 字典', () => {
  it('zh/en 键集合完全一致（防漏翻）', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
  })

  it('分区标题与描述键齐备', () => {
    expect(zh.nav).toBe('通知&信使')
    expect(en.nav).toBe('Messenger')
    expect(zh['section.description']).toBeTruthy()
    expect(en['section.description']).toBeTruthy()
  })

  it('CARD_FIELDS 的 label/hint 键在字典中（缺键会 fail loud 显示键名）', () => {
    const keys = new Set([...Object.keys(zh), ...Object.keys(en)])
    for (const spec of CARD_FIELDS) {
      expect(keys.has(spec.label), `missing label key: ${spec.label}`).toBe(true)
      if (spec.hint !== undefined) {
        expect(keys.has(spec.hint), `missing hint key: ${spec.hint}`).toBe(true)
      }
    }
  })

  it('分组标题键在字典中', () => {
    const keys = new Set([...Object.keys(zh), ...Object.keys(en)])
    for (const key of Object.values(GROUP_TITLE_KEYS)) {
      expect(keys.has(key), `missing group key: ${key}`).toBe(true)
    }
  })
})
