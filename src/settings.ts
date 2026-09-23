/**
 * 配置层：把本插件在 profile 中的条目配置接入为「有效配置」句柄。
 *
 * ⚠️ DSH 0.1.7 起，settings 命名空间**不再是插件自己注册的**：
 * - 命名空间 = profile 中该插件条目的 id（本仓库 cordis.yml / cordis.patch.yml
 *   均声明为 `messager`）；
 * - schema = 插件模块导出的 `Config`（即 src/config.ts），由 Loader 自动接管；
 * - 因此**不存在** `ctx.settings.register(ns, schema, …)` 这种 API（0.1.2 时代的
 *   写法，0.1.7 已移除，调用即崩溃）。
 *
 * 本模块只做两件事：
 * 1. 沿 fiber 父链解析出「本插件自己的」条目**原始行 id** 作为命名空间
 *    （不硬编码，避免 bundle / cordis.yml / marketplace 各种装载方式下 id 不一致；
 *    注意必须用 `entry.options.id`，理由见 `entryIdOfFiber`）；
 * 2. 经 `settings.describe()` 读取该条目的有效值，并经
 *    `settings/document-updated` 事件驱动热更新。
 *
 * settings 服务可能晚于本插件挂载，必须在 `ctx.inject(['settings'], …)` 回调内
 * 调用本模块（见 src/index.ts），不能直接 `ctx.get('settings')`。
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-host-webserver'
// 类型合并：Fiber 上挂载 Loader 条目（`ctx.fiber.entry`）。
import type {} from '@deepseek-ai/cordis-plugin-loader'
import { resolveConfig, type Config as ConfigShape } from './config.js'

/** 本插件条目 id 的兜底值（与 cordis.yml / cordis.patch.yml 一致）。 */
export const FALLBACK_ENTRY_ID = 'messager'

/** settings 服务中我们真正用到的最小面（便于测试替身）。 */
export interface SettingsServiceLike {
  readonly writable: boolean
  describe(options?: { redactSecrets?: boolean }): ReadonlyArray<{
    ns: string
    value: unknown
    revision: number
    base?: unknown
    user?: unknown
  }>
}

/** 配置句柄。 */
export interface MessagerSettings {
  /** 解析出的条目 id（settings 命名空间）。 */
  readonly namespace: string
  /** 当前有效配置（默认值 → base → 用户层）。 */
  get(): ConfigShape
  /**
   * 订阅配置变更。`onChange` 在每次 revision 前进时被调用一次。
   * @returns 注销函数。
   */
  subscribe(onChange: (next: ConfigShape) => void): () => void
}

/**
 * 沿 fiber 父链上溯，找挂着 Loader 条目的那一层，取其**原始行 id**。
 *
 * ⚠️ 必须用 `entry.options.id`，**不能**用 `entry.id`：
 * `Entry.id` 是带父级前缀的复合 id（profile 的行都挂在根 include 下，
 * 形如 `include:messager`），而 settings 命名空间用的是原始行 id
 * （`settings.describe()` 返回的 `ns` 即 `entry.options.id`，见
 * packages/settings/settings/src/index.ts）。用错会导致命名空间永远匹配不上，
 * 表现为设置页与配置路由一律 `unavailable` 且无任何报错。
 */
function entryIdOfFiber(fiber: unknown): string | undefined {
  let current = fiber as
    | { entry?: { options?: { id?: string } }; parent?: { fiber?: unknown } }
    | undefined
  const visited = new Set<unknown>()
  while (current !== undefined && current !== null && !visited.has(current)) {
    visited.add(current)
    const id = current.entry?.options?.id
    if (typeof id === 'string' && id !== '') return id
    const parent = current.parent?.fiber
    if (parent === current) return undefined
    current = parent as typeof current
  }
  return undefined
}

/**
 * 解析本插件在 profile 中的条目 id（= settings 命名空间）。
 *
 * 沿 fiber 父链找 Loader 条目的**原始行 id**：`ctx.inject` 回调拿到的是**子**
 * fiber，条目挂在上层，因此必须上溯 —— 与 `Loader.locate` 的走法一致。
 *
 * 不用 `Loader.locate()`：它返回的是 `Entry.id`（带父级前缀的复合 id，如
 * `include:messager`），而 settings 要的是原始行 id（见 entryIdOfFiber 说明）。
 *
 * 解析不出来时退回条目名 `messager`（与 cordis.yml / cordis.patch.yml 一致），
 * 不抛错 —— 解析失败不应阻断通知功能。之所以不硬编码：不同装载方式
 * （bundle 的 cordis.patch.yml / dev 的 cordis.yml / marketplace 安装）
 * 可能给出不同的条目 id。
 *
 * @param ctx - 插件上下文（apply 的 ctx，或其 inject 子上下文）。
 * @returns 条目 id。
 */
export function resolveNamespace(ctx: Context): string {
  return entryIdOfFiber(ctx.fiber) ?? FALLBACK_ENTRY_ID
}

/**
 * 从 describe() 结果里取指定命名空间的有效值并解析为完整 Config。
 * 条目不存在（插件尚未被 profile 接管）→ 返回 undefined。
 */
function readNamespace(settings: SettingsServiceLike, namespace: string): ConfigShape | undefined {
  let descriptors: ReturnType<SettingsServiceLike['describe']>
  try {
    descriptors = settings.describe({ redactSecrets: true })
  } catch {
    return undefined
  }
  const descriptor = descriptors.find(candidate => candidate.ns === namespace)
  if (descriptor === undefined) return undefined
  const value: unknown = descriptor.value
  if (value === null || typeof value !== 'object') return undefined
  return resolveConfig(value as Partial<ConfigShape>)
}

/**
 * 建立配置句柄。
 *
 * @param ctx - 已注入 settings 的上下文（inject 回调的 scope）。
 * @param settings - settings 服务。
 * @param base - Loader config（cordis.yml 的 config 段），条目未就绪时兜底。
 * @returns 配置句柄。
 */
export function createMessagerSettings(
  ctx: Context,
  settings: SettingsServiceLike,
  base: ConfigShape,
): MessagerSettings {
  const namespace = resolveNamespace(ctx)
  // 条目尚未出现在 describe() 中时用 Loader config 起步，等待 document-updated 追上。
  let current = readNamespace(settings, namespace) ?? resolveConfig(base)

  return {
    namespace,
    get: () => current,
    subscribe: (onChange) => {
      // ctx.on 的返回值即注销函数；随注入 scope 自动卸载。
      const off = ctx.on('settings/document-updated', (ns) => {
        if (ns !== namespace) return
        const next = readNamespace(settings, namespace)
        if (next === undefined) return
        current = next
        onChange(next)
      })
      return () => { void off() }
    },
  }
}