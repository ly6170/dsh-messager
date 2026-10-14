import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { BrowserNotifier } from '../src/client/index.ts'
import { resolveConfig } from '../src/config.ts'

function list(phase: string | null, running = false, id = 'g1'): SessionListState {
  return { byId: { root: { id: 'root', displayTitle: 'Fixture', running, retainedBy: {},
    projectionValues: { goal: phase === null ? null : { goal: { id, phase } } },
  } } } as unknown as SessionListState
}

describe('browser Goal delivery', () => {
  const sent: { title: string; options: NotificationOptions }[] = []
  let storage: Map<string, string>
  let backgrounded = true
  beforeEach(() => {
    sent.length = 0
    storage = new Map()
    backgrounded = true
    vi.stubGlobal('document', { get visibilityState() { return backgrounded ? 'hidden' : 'visible' }, hasFocus: () => !backgrounded })
    vi.stubGlobal('window', { localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) } })
    vi.stubGlobal('Notification', class {
      static permission = 'granted'
      constructor(title: string, options: NotificationOptions) { sent.push({ title, options }) }
    })
  })
  afterEach(() => vi.unstubAllGlobals())
  function notifier() {
    const config = resolveConfig({ triggers: { goalCompletionOnly: true } })
    const instance = new BrowserNotifier({ get: () => config, subscribe: () => () => {}, refresh: async () => {} })
    return { instance, config }
  }
  it('delivers different goals with distinct tags inside the cooldown window', () => {
    const { instance } = notifier()
    instance.onListChange(list('active'), list('complete'))
    instance.onListChange(list('complete'), list('complete', false, 'g2'))
    expect(sent.map(item => item.title)).toEqual(['Goal 已完成', 'Goal 已完成'])
    expect(sent[0]?.options.tag).not.toBe(sent[1]?.options.tag)
  })
  it('deduplicates the same goal across notifier instances even after cooldown', () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1000)
    notifier().instance.onListChange(list('active'), list('complete'))
    now.mockReturnValue(100000)
    notifier().instance.onListChange(list('active'), list('complete'))
    expect(sent).toHaveLength(1)
    now.mockRestore()
  })
  it('preserves independent error switches while suppressing intermediate turns', () => {
    const { instance, config } = notifier()
    instance.onListChange(list('active', true), list('active'))
    instance.onError('root' as SessionId, 'fixture', list('active'))
    expect(sent.map(item => item.title)).toEqual(['任务出错'])
    config.triggers.error = false
    instance.onError('other' as SessionId, 'fixture', list('active'))
    expect(sent).toHaveLength(1)
  })
  it('consumes completions while browser/trigger notifications are off or the window is visible', () => {
    for (const gate of ['browser', 'trigger', 'foreground'] as const) {
      const { instance, config } = notifier()
      if (gate === 'browser') config.browser.enabled = false
      if (gate === 'trigger') config.triggers.completed = false
      if (gate === 'foreground') backgrounded = false
      instance.onListChange(list('active'), list('complete'))
      config.browser.enabled = true; config.triggers.completed = true; backgrounded = true
      instance.onListChange(list('active'), list('complete'))
    }
    expect(sent).toHaveLength(0)
  })
})
