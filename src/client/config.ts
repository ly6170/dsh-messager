/**
 * 客户端配置读取：经 host 配置路由（GET /dsh-messager/config）拉取 messager
 * 命名空间有效值，并通过 `settings/document-updated` 失效后重拉。
 * 路由不受 Web 设置白名单门控，发行版同样可用；拉取失败回退 schema 默认值。
 */

import { resolveConfig, type Config } from '../config.js'
import { CONFIG_PATH, type ConfigView } from '../config-shared.js'

export interface ClientConfigHandle {
  get(): Config
  subscribe(listener: () => void): () => void
  refresh(): Promise<void>
}

export class ClientConfig implements ClientConfigHandle {
  private current: Config = resolveConfig({})
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

  /** 拉取 host 配置视图（首次与收到 document-updated 后调用）。 */
  async refresh(): Promise<void> {
    try {
      const response = await fetch(CONFIG_PATH, { headers: { accept: 'application/json' } })
      if (!response.ok) return
      const view = (await response.json()) as ConfigView
      if (view.status !== 'ready' || view.value === undefined) return
      this.current = resolveConfig(view.value as Partial<Config>)
      for (const listener of [...this.listeners]) listener()
    } catch {
      // 拉取失败（路由未挂载/网络问题）保持当前值，不打断插件
    }
  }
}
