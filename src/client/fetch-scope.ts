/**
 * fetch 版 ScopeLike：浏览器经 /dsh-messager/config 路由读写配置。
 * 替代 settingsScope（受 Web 设置白名单门控）—— 本通道不受门控，发行版可用。
 *
 * - getSnapshot：缓存视图（初始 loading；无变化时返回同一引用，满足
 *   useSyncExternalStore 契约）；
 * - subscribe：document-updated 事件或显式 refresh 时重新 GET 并通知；
 * - writeOps：POST 逐字段 ops，成功后重新 GET。
 *
 * fetcher 可注入，便于单测。
 */

import type { ConfigView, ConfigWriteBody } from '../config-shared.js'
import type { ScopeLike, ScopeWriteOp } from './card-controller.js'

/** 路由访问器（浏览器 fetch 实现见 client/index.ts；测试注入替身）。 */
export interface ConfigFetcher {
  get(): Promise<ConfigView>
  write(body: ConfigWriteBody): Promise<{ ok: boolean; error?: string }>
}

/** 快照形状（与 ScopeLike.getSnapshot 声明一致）。 */
interface ViewSnapshot {
  status: string
  value: unknown
  user: unknown
  base: unknown
  writable: boolean
  mode?: string
  revision?: number
}

export interface FetchScope {
  scope: ScopeLike
  /** 重新拉取配置视图（document-updated 或手动触发）。 */
  refresh(): Promise<void>
}

/** 创建 fetch 版 scope。 */
export function createFetchScope(fetcher: ConfigFetcher): FetchScope {
  let view: ViewSnapshot = {
    status: 'loading',
    value: undefined,
    user: undefined,
    base: undefined,
    writable: false,
    mode: 'host',
  }
  const listeners = new Set<() => void>()
  const notify = (): void => {
    for (const listener of [...listeners]) listener()
  }

  const refresh = async (): Promise<void> => {
    let next: ConfigView
    try {
      next = await fetcher.get()
    } catch {
      // 拉取失败（路由未挂载等）：标记不可用，不打断订阅者
      view = { ...view, status: 'unavailable' }
      notify()
      return
    }
    view = {
      status: next.status,
      value: next.value,
      user: next.user,
      base: next.base,
      writable: next.writable,
      mode: next.mode,
      revision: next.revision,
    }
    notify()
  }

  const scope: ScopeLike = {
    getSnapshot: () => view,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    async set(field: string, value: unknown) {
      await scope.writeOps([{ op: 'set', path: [field], value }])
    },
    async unset(field: string) {
      await scope.writeOps([{ op: 'unset', path: [field] }])
    },
    async writeOps(ops: readonly ScopeWriteOp[]) {
      const result = await fetcher.write({ ops: ops as ConfigWriteBody['ops'] })
      if (result.ok) await refresh()
      return result.ok
    },
  }

  return { scope, refresh }
}
