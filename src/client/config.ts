/**
 * 客户端配置读取：settings RPC 拉取 host 端注册的 `messager` 命名空间有效值
 * （默认值 → base → 用户层），并通过 `settings/document-updated` 失效后重拉。
 * 无 api（settings 服务缺失等）时回退 schema 默认值，浏览器通道仍可用。
 */

import type { IApiClient } from '@deepseek-ai/dsh-api-remotes/client'
import { resolveConfig, type Config } from '../config.js'

/** settings 命名空间（host 端注册，见 src/settings.ts）。 */
export const MESSAGER_NAMESPACE = 'messager'

export interface ClientConfigHandle {
  get(): Config
  subscribe(listener: () => void): () => void
  refresh(): Promise<void>
}

export class ClientConfig implements ClientConfigHandle {
  private current: Config = resolveConfig({})
  private readonly listeners = new Set<() => void>()

  constructor(private readonly api: IApiClient | undefined) {}

  get(): Config {
    return this.current
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** 拉取 host settings 命名空间的有效值（首次与收到 document-updated 后调用）。 */
  async refresh(): Promise<void> {
    if (this.api === undefined) return
    try {
      const response = await this.api.settings.describe({})
      const result = response.result
      if (!result.ok) return
      const view = result.value.namespaces.find(ns => ns.ns === MESSAGER_NAMESPACE)
      if (view === undefined || view.value === undefined) return
      this.current = resolveConfig(view.value as Partial<Config>)
      for (const listener of [...this.listeners]) listener()
    } catch {
      // 拉取失败保持当前值（settings 服务缺失/loopback 权限不足等），不打断插件
    }
  }
}
