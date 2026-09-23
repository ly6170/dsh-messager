/**
 * 客户端配置读取：经 host 配置路由（GET /dsh-messager/config）拉取 messager
 * 命名空间有效值，并通过 `settings/document-updated` 失效后重拉。
 * 路由不受 Web 设置白名单门控，发行版同样可用。
 *
 * ⚠️ 拉取失败时的兜底值必须**关闭**通知（见 FAIL_SAFE），不能用 schema 默认值：
 * `browser.enabled` 的 schema 默认值是 `true`，用它兜底意味着任何一次拉取失败
 * 都会在用户已关闭通知的情况下静默开启推送 —— 表现为「我明明关了还弹」。
 */

import { resolveConfig, type Config } from '../config.js'
import { CONFIG_PATH, type ConfigView } from '../config-shared.js'

export interface ClientConfigHandle {
  get(): Config
  subscribe(listener: () => void): () => void
  refresh(): Promise<void>
}

/**
 * 拉取成功前的失效安全值：**显式关闭浏览器通知**。
 * 通知类插件的正确取向是「宁可漏报，不可误报」：未确认用户意愿前一律不推。
 */
const FAIL_SAFE: Config = resolveConfig({ browser: { enabled: false } })

export class ClientConfig implements ClientConfigHandle {
  private current: Config = FAIL_SAFE
  private readonly listeners = new Set<() => void>()

  get(): Config {
    return this.current
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /**
   * 拉取 host 配置视图。
   *
   * 失败（路由未挂载 / 网络问题 / 视图非 ready）时**保持上一次的已知值**；
   * 若从未成功过，则保持 FAIL_SAFE（通知关闭）。
   */
  async refresh(): Promise<void> {
    try {
      const response = await fetch(CONFIG_PATH, { headers: { accept: 'application/json' } })
      if (!response.ok) return
      const view = (await response.json()) as ConfigView
      if (view.status !== 'ready' || view.value === undefined) return
      this.current = resolveConfig(view.value as Partial<Config>)
      for (const listener of [...this.listeners]) listener()
    } catch {
      // 拉取失败：保持当前值，不打断插件
    }
  }
}
