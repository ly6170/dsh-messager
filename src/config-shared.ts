/**
 * 配置路由的跨端共享类型（host 与浏览器 client 共用，不得 import 任何
 * Node/浏览器专属模块）。
 */

/** 配置路由路径（挂在 DSH webServer 上，同源访问）。 */
export const CONFIG_PATH = '/dsh-messager/config'

/** client ScopeLike 快照同构的配置视图。 */
export interface ConfigView {
  status: 'ready' | 'unavailable'
  value: unknown
  user: unknown
  base: unknown
  writable: boolean
  mode: 'host'
  revision?: number
}

/** client ScopeWriteOp 同构的写操作。 */
export interface ConfigWriteOp {
  op: 'set' | 'unset'
  path: string[]
  value?: unknown
}

/** POST /dsh-messager/config 的请求体。 */
export interface ConfigWriteBody {
  ops: ConfigWriteOp[]
  expectedRevision?: number
}
