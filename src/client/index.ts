/**
 * dsh-messager —— DeepSeek Harness 通知插件（浏览器 client 端）。
 *
 * 功能：
 * 1. 浏览器通知：基于客户端会话摘要（ctx.sessions.list）投递，语义与 Web UI
 *    状态圆点一致（橙点=需要交互、绿点=任务完成）。
 * 2. 设置页卡片：在 DSH 设置 → Plugins 标签页注册 dsh-messager 配置卡片，
 *    经 ctx.settingsScope 读写 `messager` 命名空间（用户层，实时生效）。
 *
 * 行为要点：
 * - 配置与 host 端同源（settings 命名空间 `messager`，document-updated 失效重拉）；
 * - `onlyWhenHidden`（默认 true）：页面可见时不弹，避免看着界面还被打扰；
 * - tag 去重 + localStorage 跨标签页冷却，多开标签不重复弹；
 * - 点击通知聚焦窗口；权限未授予时在插件加载时请求一次。
 */

import type { Context } from '@deepseek-ai/cordis'
// 类型合并（ctx.remote/slots 等声明）+ SettingsPathOpView 类型
import type { SettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-runtime/client'
import type { SessionListState } from '@deepseek-ai/dsh-client-runtime/client'
// 类型合并：ctx.settingsScope（ui-settings）与 settings.plugin.item 槽位（ui-settings-plugins）
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import type { Verbosity } from '../config.js'
import type { Config } from '../config.js'
import { ClientConfig, type ClientConfigHandle } from './config.js'
import { diffSessionSummaries, type ClientNotice } from './diff.js'
import { CARD_FIELDS, MessagerCardController, type ScopeLike } from './card-controller.js'
import { MessagerCard } from './messager-card.js'

export const name = 'dsh-messager'

/** 依赖的客户端服务：会话列表、连接（api）、远程事件、设置作用域、槽位。 */
export const inject = ['sessions', 'connection', 'remote', 'settingsScope', 'slots']

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
    const config = this.config.get()
    if (!config.browser.enabled) return
    if (typeof Notification === 'undefined') return
    if (Notification.permission !== 'granted') return
    if (config.browser.onlyWhenHidden && document.visibilityState !== 'hidden') return

    const notices = diffSessionSummaries(previous.byId, next.byId, next.current)
    for (const notice of notices) {
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
    } else {
      base = '任务完成'
    }
    const prefix = config.message.titlePrefix
    return prefix === undefined || prefix === '' ? base : `${prefix} ${base}`
  }

  private bodyOf(notice: ClientNotice, config: Config, verbosity: Verbosity): string {
    const lines: string[] = []
    if (verbosity === 'minimal') return ''
    if (config.message.includeSessionTitle && notice.title !== undefined) {
      lines.push(`会话：${notice.title}`)
    }
    if (verbosity === 'detailed') {
      lines.push(`打开：${config.message.guiUrl}`)
    }
    return lines.join('\n')
  }
}

export function apply(ctx: Context): void {
  // connection 服务没有公开的类型合并声明，按 ui-settings 同款模式经 ctx.get 断言
  const connection = ctx.get('connection') as ConnectionHandle | undefined
  const config = new ClientConfig(connection?.api)
  void config.refresh()

  // 设置变更（host/设置页）→ 重拉有效配置
  const offRemote = ctx.remote.$on('settings/document-updated', () => {
    void config.refresh()
  })
  ctx.effect(() => () => offRemote?.(), 'dsh-messager: settings invalidation')

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

  // 设置页卡片：绑定 messager 命名空间作用域并注册到 Plugins 标签页。
  // scope 的 set/unset 只支持单层路径，且整组 set 是替换语义（会抹掉 write-only
  // 密钥、并在脱敏回显下误报失败）—— 因此保存走直连 api 的逐字段嵌套路径写，
  // scope 仍负责读取/订阅/修订号；写成功后 seam 广播 document-updated 使 scope
  // 自动重拉（失败路径无事件，这里显式触发一次 load 兜底）。
  const scope = ctx.settingsScope.bind<Record<string, unknown>>({
    namespace: 'messager',
  })
  const settingsApi = connection?.api
  const adapter: ScopeLike = {
    getSnapshot: () => scope.getSnapshot(),
    subscribe: (listener) => scope.subscribe(listener),
    set: (field, value) => scope.set(field, value),
    unset: (field) => scope.unset(field),
    async writeOps(ops) {
      // memory 模式（非 loopback 访问）或 settings 缺失：与 scope 行为一致，静默成功
      if (settingsApi === undefined || connection?.isLoopback !== true) return true
      const revision = scope.getSnapshot().revision
      let ok = false
      try {
        const response = await settingsApi.settings.mutate({
          ns: 'messager',
          ops: ops as unknown as SettingsPathOpView[],
          ...(revision === undefined ? {} : { expectedRevision: revision }),
        })
        ok = response.result.ok
      } catch {
        ok = false
      }
      // 兜底重拉：失败（冲突/拒绝）时无 document-updated 事件，scope 需要收敛到最新视图
      try {
        void (scope as unknown as { load?: () => Promise<void> }).load?.()
      } catch {
        // 旧实现无 load：成功路径依赖事件刷新
      }
      return ok
    },
  }
  const controller = new MessagerCardController(adapter, CARD_FIELDS)
  ctx.slots.inject('settings.plugin.item', function* () {
    yield ctx.slots.register({
      name: 'settings.plugin.item',
      id: 'dsh-messager',
      order: 100,
      inject: () => controller.inject(),
    }, MessagerCard)
  })

  // 权限：default 状态时请求一次（部分浏览器需用户手势，README 有说明）
  if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
    void Notification.requestPermission()
  }

  ctx.logger.info('[dsh-messager] client loaded')
}
