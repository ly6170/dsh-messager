/**
 * 配置层：把 Loader config（cordis.yml）注册为 settings 命名空间 `messager`
 * 的 base 层，设置页可编辑用户层覆盖。
 *
 * 注意：settings 服务可能晚于本插件加载，必须在 `ctx.inject(['settings'], …)`
 * 回调内调用本模块（见 src/index.ts），不能直接 `ctx.get('settings')`。
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'
import { Config, type Config as ConfigShape } from './config.js'

export interface MessagerSettings {
  /** 当前有效配置（默认值 → base → 用户层）。 */
  get(): ConfigShape
  /** 监听配置变更（提交后按序调用，返回注销函数）。 */
  watch(callback: (next: ConfigShape, prev: ConfigShape) => void): () => void
}

/**
 * 在 settings 服务就绪的上下文中注册命名空间。
 * @param ctx - 已注入 settings 的上下文（inject 回调的 scope）。
 * @param base - Loader config（cordis.yml 的 config 段）。
 * @returns 设置句柄（注册本身是 effect，随注入 scope 卸载）。
 */
export function registerMessagerSettings(ctx: Context, base: ConfigShape): MessagerSettings {
  const scope = ctx.settings.register('messager', Config, { base, applies: 'live' })
  return {
    get: () => scope.get(),
    watch: (callback) => scope.watch(callback),
  }
}
