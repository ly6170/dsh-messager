import { afterEach, describe, expect, it, vi } from 'vitest'
import { ClientConfig } from '../src/client/config.ts'
import { triggerAllows, type ClientNotice } from '../src/client/diff.ts'

/** 造一个 ready 视图响应。 */
function readyResponse(value: unknown): Response {
  return {
    ok: true,
    json: async () => ({ status: 'ready', value, writable: true, mode: 'host', revision: 1 }),
  } as unknown as Response
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ClientConfig 失效安全兜底', () => {
  it('拉取成功前一律关闭浏览器通知（不用 schema 默认值兜底）', () => {
    const config = new ClientConfig()
    // schema 默认值里 browser.enabled 是 true；兜底值必须是 false
    expect(config.get().browser.enabled).toBe(false)
  })

  it('拉取失败后仍保持关闭，不会静默开启通知', async () => {
    const config = new ClientConfig()
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down') }))
    await config.refresh()
    expect(config.get().browser.enabled).toBe(false)
  })

  it('视图非 ready（如 unavailable）时保持关闭', async () => {
    const config = new ClientConfig()
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ status: 'unavailable', writable: true, mode: 'host' }),
    }) as unknown as Response))
    await config.refresh()
    expect(config.get().browser.enabled).toBe(false)
  })

  it('拉取成功后采用 host 的有效值', async () => {
    const config = new ClientConfig()
    vi.stubGlobal('fetch', vi.fn(async () => readyResponse({
      browser: { enabled: true, onlyWhenHidden: false, verbosity: 'normal' },
      system: { enabled: false, verbosity: 'normal' },
    })))
    await config.refresh()
    expect(config.get().browser.enabled).toBe(true)
    expect(config.get().browser.onlyWhenHidden).toBe(false)
  })

  it('拉取成功后转为失败：保持上一次的已知值，不回退到兜底', async () => {
    const config = new ClientConfig()
    const fetchMock = vi.fn(async () => readyResponse({
      browser: { enabled: true, onlyWhenHidden: false, verbosity: 'normal' },
    }))
    vi.stubGlobal('fetch', fetchMock)
    await config.refresh()
    expect(config.get().browser.enabled).toBe(true)

    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down') }))
    await config.refresh()
    expect(config.get().browser.enabled).toBe(true)
  })
})

describe('triggerAllows（浏览器通道的 triggers 门控）', () => {
  const interaction: ClientNotice = { kind: 'interaction', sessionId: 's1' as never, interaction: 'approval' }
  const completed: ClientNotice = { kind: 'completed', sessionId: 's1' as never }

  it('interaction 触发受 triggers.interaction 控制', () => {
    expect(triggerAllows(interaction, { interaction: true, completed: false })).toBe(true)
    expect(triggerAllows(interaction, { interaction: false, completed: true })).toBe(false)
  })

  it('completed 触发受 triggers.completed 控制', () => {
    expect(triggerAllows(completed, { interaction: false, completed: true })).toBe(true)
    expect(triggerAllows(completed, { interaction: true, completed: false })).toBe(false)
  })
})
