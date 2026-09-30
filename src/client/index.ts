/**
 * dsh-messager —— DeepSeek Harness 通知插件（浏览器 client 端）。
 *
 * 功能：
 * 1. 浏览器通知：基于客户端会话摘要（ctx.sessions.list）投递，语义与 Web UI
 *    状态圆点一致（橙点=需要交互、绿点=任务完成）。
 * 2. 设置页分区「通知&信使」：注册到 settings.section（Agent预设下方，动态
 *    order），经 host 配置路由（/dsh-messager/config，webServer 通道）读写
 *    `messager` 命名空间 —— 不受 Web 设置白名单门控，发行版同样可用。
 *
 * 行为要点：
 * - 配置与 host 端同源（settings 命名空间 `messager`，document-updated 失效重拉）；
 * - `onlyWhenHidden`（默认 true）：页面可见时不弹，避免看着界面还被打扰；
 * - tag 去重 + localStorage 跨标签页冷却，多开标签不重复弹；
 * - 点击通知聚焦窗口；权限未授予时在插件加载时请求一次。
 */

import type { Context } from '@deepseek-ai/cordis'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type { SessionStatusSnapshot } from '@deepseek-ai/dsh-client-ui-session/client'
// 类型合并：ctx.locale（dsh-client-locale）与 settings.section 槽位声明（ui-settings）
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { Verbosity } from '../config.js'
import type { Config } from '../config.js'
import { ClientConfig, type ClientConfigHandle } from './config.js'
import { diffPendingInteractions, diffSessionSummaries, errorNotice, triggerAllows, type ClientNotice } from './diff.js'
import { CARD_FIELDS, MessagerCardController } from './card-controller.js'
import { isDesktopWindow, isWindowBackgrounded } from './desktop.js'
import { createFetchScope, type ConfigFetcher } from './fetch-scope.js'
import { MessagerSection } from './section.jsx'
import { zh, en } from './locales.js'
import { CONFIG_PATH, type ConfigView, type ConfigWriteBody } from '../config-shared.js'

export const name = 'dsh-messager'

/** locale 字典命名空间（与 section 的 locale 声明一致）。 */
export const LOCALE_NS = 'dsh-messager'

/** 依赖的客户端服务：会话列表、远程事件（document-updated）、槽位、locale。 */
export const inject = ['sessions', 'uiSession', 'remote', 'slots', 'locale']

/** localStorage 跨标签页去重键前缀。 */
const STORAGE_PREFIX = 'dsh-messager:notified:'

/** 浏览器通知投递器。 */
class BrowserNotifier {
  /** `${kind}:${sessionId}` → 上次投递时间戳（内存冷却）。 */
  private readonly cooldowns = new Map<string, number>()

  constructor(private readonly config: ClientConfigHandle) {}

  dispose(): void {
    this.cooldowns.clear()
  }

  /** 列表快照变化 → 通知。 */
  onListChange(previous: SessionListState, next: SessionListState): void {
    // 用户没在看（后台/最小化）时，连「当前打开的会话」完成了也要提醒；
    // 页面可见仍在通知（onlyWhenHidden=false）时保留该过滤，避免打扰正看着的会话。
    this.onNotices(diffSessionSummaries(previous.byId, next.byId, {
      ignoreMainView: BrowserNotifier.backgrounded(),
    }))
  }

  /** 待交互状态变化 → 通知。 */
  onPendingChange(
    previous: SessionStatusSnapshot,
    next: SessionStatusSnapshot,
    sessions: SessionListState,
  ): void {
    this.onNotices(diffPendingInteractions(previous, next, sessions.byId))
  }

  /** 任务出错（宿主 `agent/error` 经 `api-session/error` 转发）→ 通知。 */
  onError(sessionId: SessionId, message: string, sessions: SessionListState): void {
    this.onNotices([errorNotice(sessionId, message, sessions.byId)])
  }

  /**
   * 用户现在是否「没在看这个窗口」。
   *
   * 浏览器：页面 hidden（切走标签页 / 最小化）；桌面版：再补上「失去焦点」——
   * 桌面窗口被别的窗口盖住时 `visibilityState` 仍是 `visible`，
   * 只看它会导致切到别的应用就永远不提醒（见 src/client/desktop.ts）。
   */
  private static backgrounded(): boolean {
    if (typeof document === 'undefined') return false
    return isWindowBackgrounded({
      desktop: isDesktopWindow(),
      visibilityState: document.visibilityState,
      hasFocus: document.hasFocus(),
    })
  }

  private onNotices(notices: readonly ClientNotice[]): void {
    const config = this.config.get()
    if (!config.browser.enabled) return
    if (typeof Notification === 'undefined') return
    if (Notification.permission !== 'granted') return
    if (config.browser.onlyWhenHidden && !BrowserNotifier.backgrounded()) return

    for (const notice of notices) {
      if (!triggerAllows(notice, config.triggers)) continue
      if (!this.allow(notice, config)) continue
      this.show(notice, config)
    }
  }

  /** 冷却 + 跨标签页去重。 */
  private allow(notice: ClientNotice, config: Config): boolean {
    const now = Date.now()
    const key = `${notice.kind}:${notice.sessionId}`
    const cooldownMs = config.dedup.interactionCooldownMs
    const last = this.cooldowns.get(key)
    if (last !== undefined && now - last < cooldownMs) return false
    try {
      const storageKey = STORAGE_PREFIX + key
      const raw = window.localStorage.getItem(storageKey)
      if (raw !== null && now - Number(raw) < cooldownMs) return false
      window.localStorage.setItem(storageKey, String(now))
    } catch {
      // localStorage 不可用（隐私模式等）时仅靠内存冷却
    }
    this.cooldowns.set(key, now)
    return true
  }

  private show(notice: ClientNotice, config: Config): void {
    const verbosity = config.browser.verbosity
    const notification = new Notification(this.titleOf(notice, config), {
      ...(verbosity === 'minimal' ? {} : { body: this.bodyOf(notice, config, verbosity) }),
      ...(config.browser.icon === undefined ? {} : { icon: config.browser.icon }),
      // tag 同键通知自动替换，避免同一会话反复堆叠
      tag: `dsh-messager:${notice.kind}:${notice.sessionId}`,
    })
    notification.onclick = () => {
      window.focus()
      notification.close()
    }
  }

  private titleOf(notice: ClientNotice, config: Config): string {
    let base: string
    if (notice.kind === 'interaction') {
      base = notice.interaction === 'approval'
        ? '需要交互：等待审批'
        : notice.interaction === 'plan-review'
          ? '需要交互：计划待审'
          : '需要交互：等待回答'
    } else if (notice.kind === 'error') {
      base = '任务出错'
    } else {
      base = '任务完成'
    }
    const prefix = config.message.titlePrefix
    return prefix === undefined || prefix === '' ? base : `${prefix} ${base}`
  }

  private bodyOf(notice: ClientNotice, config: Config, verbosity: Verbosity): string {
    const lines: string[] = []
    if (verbosity === 'minimal') return ''
    if (notice.kind === 'error' && notice.message !== undefined && notice.message !== '') {
      lines.push(`错误：${notice.message}`)
    }
    if (config.message.includeSessionTitle && notice.title !== undefined) {
      lines.push(`会话：${notice.title}`)
    }
    return lines.join('\n')
  }
}

export function apply(ctx: Context): void {
  const config = new ClientConfig()
  void config.refresh()

  // 配置路由访问器（同源 fetch；路由由 host 半挂载，见 src/config-route.ts）
  const fetcher: ConfigFetcher = {
    get: async (): Promise<ConfigView> => {
      const response = await fetch(CONFIG_PATH, { headers: { accept: 'application/json' } })
      if (!response.ok) throw new Error(`config route responded ${response.status}`)
      return (await response.json()) as ConfigView
    },
    write: async (body: ConfigWriteBody) => {
      try {
        const response = await fetch(CONFIG_PATH, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        })
        const result = (await response.json()) as { ok: boolean; error?: string }
        return { ok: response.ok && result.ok === true, error: result.error }
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    },
  }
  const fetchScope = createFetchScope(fetcher)
  void fetchScope.refresh()

  // 设置变更（host/设置页/本分区保存）→ 重拉有效配置与表单视图
  const offRemote = ctx.remote.$on('settings/document-updated', () => {
    void config.refresh()
    void fetchScope.refresh()
  })
  ctx.effect(() => () => offRemote?.(), 'dsh-messager: settings invalidation')

  // 标签页重新可见时补拉一次配置。
  // 后台标签页可能错过 settings/document-updated（浏览器挂起标签、WebSocket 被断），
  // 而 refresh 没有重试，配置会长期停留在旧值 —— 曾表现为「已关闭通知仍弹出」。
  const onVisibilityChange = (): void => {
    if (document.visibilityState !== 'visible') return
    void config.refresh()
    void fetchScope.refresh()
  }
  document.addEventListener('visibilitychange', onVisibilityChange)
  ctx.effect(
    () => () => document.removeEventListener('visibilitychange', onVisibilityChange),
    'dsh-messager: visibility refresh',
  )

  const notifier = new BrowserNotifier(config)
  ctx.effect(() => () => notifier.dispose(), 'dsh-messager: browser notifier')

  // 会话列表快照 diff
  let previous = ctx.sessions.list.getSnapshot()
  const offList = ctx.sessions.list.subscribe(() => {
    const next = ctx.sessions.list.getSnapshot()
    notifier.onListChange(previous, next)
    previous = next
  })
  ctx.effect(() => () => offList(), 'dsh-messager: sessions subscription')

  // 当前快照只作为基线，不补发插件加载前已经存在的交互。
  let previousStatus = ctx.uiSession.sessionStatus.getSnapshot()
  const offStatus = ctx.uiSession.sessionStatus.subscribe(() => {
    const next = ctx.uiSession.sessionStatus.getSnapshot()
    notifier.onPendingChange(previousStatus, next, ctx.sessions.list.getSnapshot())
    previousStatus = next
  })
  ctx.effect(() => () => offStatus(), 'dsh-messager: session status subscription')

  // 任务出错：宿主 `agent/error` 经 `api-session/error` 转发到客户端。
  // 桌面版默认只开渲染端通道（system 通道默认关），错误提醒靠这条覆盖。
  const offError = ctx.remote.$on('api-session/error', (sessionId, message) => {
    notifier.onError(sessionId, message, ctx.sessions.list.getSnapshot())
  })
  ctx.effect(() => () => offError(), 'dsh-messager: error subscription')

  // 设置页分区「通知&信使」：注册到 settings.section。
  // 数据经 webServer 配置路由读写（不受白名单门控），控制器与表单复用
  // MessagerCardController / MessagerSettingsForm；文案走 locale 字典。
  // 桌面版窗口下隐藏「没必要打开」的字段（system 组）：打开只会让同一事件弹两次。
  const controller = new MessagerCardController(fetchScope.scope, CARD_FIELDS, {
    desktop: isDesktopWindow(),
  })
  ctx.effect(() => ctx.locale.register(LOCALE_NS, { zh, en }), 'dsh-messager: locale dictionaries')
  const t = ctx.locale.bind(LOCALE_NS)
  ctx.slots.inject('settings.section', function* () {
    // 动态 order：紧随 agent-presets（Agent预设）；不存在则排在当时已注册
    // 分区之后；全空时用大数兜底 —— 语义即「自然向后排序」，不写死数值。
    const existing = ctx.slots.entries('settings.section')
    const agentPresets = existing.find(entry => entry.options.id === 'agent-presets')
    const maxOrder = existing.reduce((max, entry) => Math.max(max, entry.options.order ?? 0), 0)
    const order = agentPresets !== undefined
      ? (agentPresets.options.order ?? 0) + 1
      : existing.length > 0
        ? maxOrder + 1
        : 1000
    const face = controller.inject()
    yield ctx.slots.register({
      name: 'settings.section',
      id: 'dsh-messager',
      order,
      label: () => t('nav'),
      locale: LOCALE_NS,
      inject: () => ({ ...face, t }),
    }, MessagerSection)
  })

  // 权限：default 状态时请求一次（部分浏览器需用户手势，README 有说明）
  if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
    void Notification.requestPermission()
  }

  ctx.logger.info('[dsh-messager] client loaded')
}
