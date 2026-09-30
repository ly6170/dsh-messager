import { describe, expect, it } from 'vitest'
import { isDesktopWindow, isWindowBackgrounded } from '../src/client/desktop.ts'

describe('isDesktopWindow（桌面版窗口判定）', () => {
  it('全局对象上有 dshDesktopBoot → 桌面窗口（桌面壳 preload 注入的官方标记）', () => {
    expect(isDesktopWindow({ dshDesktopBoot: { ready: () => undefined } })).toBe(true)
    expect(isDesktopWindow({ dshDesktopBoot: undefined })).toBe(true) // 键存在即桌面
  })

  it('普通浏览器窗口（没有该标记）→ false', () => {
    expect(isDesktopWindow({ document: {}, Notification: () => undefined })).toBe(false)
    expect(isDesktopWindow({})).toBe(false)
  })

  it('非对象输入不抛错（SSR / 旧运行时）', () => {
    expect(isDesktopWindow(undefined)).toBe(false)
    expect(isDesktopWindow(null)).toBe(false)
    expect(isDesktopWindow('window')).toBe(false)
  })
})

describe('isWindowBackgrounded（onlyWhenHidden 的判定）', () => {
  it('页面 hidden（最小化 / 收托盘 / 切走标签页）→ 任何环境都算没在看', () => {
    for (const desktop of [true, false]) {
      expect(isWindowBackgrounded({ desktop, visibilityState: 'hidden', hasFocus: false })).toBe(true)
      expect(isWindowBackgrounded({ desktop, visibilityState: 'hidden', hasFocus: true })).toBe(true)
    }
  })

  it('桌面版：窗口可见但失去焦点（被别的窗口盖住）→ 算没在看（本轮修复点）', () => {
    expect(isWindowBackgrounded({ desktop: true, visibilityState: 'visible', hasFocus: false })).toBe(true)
  })

  it('桌面版：窗口可见且有焦点 → 正在看，不打扰', () => {
    expect(isWindowBackgrounded({ desktop: true, visibilityState: 'visible', hasFocus: true })).toBe(false)
  })

  it('浏览器：页面可见时即使标签页失焦也不弹（保持既有语义）', () => {
    expect(isWindowBackgrounded({ desktop: false, visibilityState: 'visible', hasFocus: false })).toBe(false)
    expect(isWindowBackgrounded({ desktop: false, visibilityState: 'visible', hasFocus: true })).toBe(false)
  })
})
