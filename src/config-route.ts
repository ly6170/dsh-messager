/**
 * dsh-messager 配置路由（host 端）：给浏览器提供不受 settings 白名单门控的
 * 配置读写通道（webServer 服务，dsh-market 同款「正门」）。
 *
 * - GET  /dsh-messager/config —— 返回 messager 命名空间的脱敏视图
 *   （value/user/base/writable/revision，与 client ScopeLike 快照同构）；
 * - POST /dsh-messager/config —— 接受逐字段 ops（与 client ScopeWriteOp 同构），
 *   经 ctx.settings.mutate 落库（host 侧不受 Web 白名单限制），
 *   写后 settings 服务自动广播 settings/document-updated（全环境转发事件）。
 *
 * 安全：访问守卫由调用方注入 —— 宿主连接服务可用时走**官方鉴权正门**
 * （`ctx.connection.requestRejection`，与宿主 `/api` 同一套 cookie 判定，本机裸进程得 401），
 * 服务缺席时退回来源校验（只防浏览器跨站）。响应不带 CORS 头，跨站 JS 无法读取；
 * GET 只读无副作用。
 * 密钥：describe({ redactSecrets: true }) 自动脱敏，写入方向与设置页一致。
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import type { SettingsPathOp } from '@deepseek-ai/dsh-settings'
import type { ConfigView, ConfigWriteBody } from './config-shared.js'
import { FALLBACK_ENTRY_ID } from './settings.js'

/**
 * 命名空间（= 本插件在 profile 中的条目 id）。
 *
 * ⚠️ 0.1.7 起 settings 命名空间就是 profile 条目 id，**不是**固定字符串。
 * 不同装载方式（bundle 的 cordis.patch.yml / dev 的 cordis.yml / marketplace）
 * 可能给出不同的 id，因此默认值只作兜底，真实值由调用方经
 * `resolveNamespace(ctx)` 反查后传入。
 */
export const CONFIG_NAMESPACE = FALLBACK_ENTRY_ID

export type { ConfigView, ConfigWriteBody } from './config-shared.js'

/** 路由依赖的 settings 服务窄接口（便于测试替身）。 */
export interface SettingsServiceLike {
  readonly writable: boolean
  describe(options?: { redactSecrets?: boolean }): ReadonlyArray<{
    ns: string
    value: unknown
    revision: number
    base?: unknown
    user?: unknown
  }>
  mutate(ns: string, ops: readonly SettingsPathOp[], expectedRevision?: number): Promise<void>
}

/** 路由注册的宿主（webServer 服务窄接口）。 */
export interface WebServerLike {
  register(route: WebRoute): () => void
}

// ---- 纯逻辑（可单测） ----

/** 把 settings 描述符映射为 client 视图；命名空间缺失 → unavailable。 */
export function configViewOf(
  settings: SettingsServiceLike,
  namespace: string = CONFIG_NAMESPACE,
  effective: (value: unknown, user: unknown) => unknown = value => value,
): ConfigView {
  const descriptor = settings.describe({ redactSecrets: true }).find(candidate => candidate.ns === namespace)
  if (descriptor === undefined) {
    return { status: 'unavailable', value: undefined, user: undefined, base: undefined, writable: settings.writable, mode: 'host' }
  }
  return {
    status: 'ready',
    // 有效值经 effective 变换（当前用途：叠加环境默认值），使设置页显示的值
    // 与 host 端**实际使用**的值一致。user/base 保持原样，供表单判断覆盖状态。
    value: effective(descriptor.value, descriptor.user),
    user: descriptor.user,
    base: descriptor.base,
    writable: settings.writable,
    mode: 'host',
    revision: descriptor.revision,
  }
}

/** 校验并规范化写请求体；非法 → undefined。 */
export function parseConfigWriteBody(raw: unknown): ConfigWriteBody | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const body = raw as Record<string, unknown>
  const ops = body.ops
  if (!Array.isArray(ops)) return undefined
  const normalized: ConfigWriteBody['ops'] = []
  for (const entry of ops) {
    if (typeof entry !== 'object' || entry === null) continue
    const op = entry as Record<string, unknown>
    if (op.op !== 'set' && op.op !== 'unset') return undefined
    if (!Array.isArray(op.path) || op.path.length === 0 || op.path.some(segment => typeof segment !== 'string' || segment === '')) {
      return undefined
    }
    if (op.op === 'set' && !('value' in op)) return undefined
    normalized.push({ op: op.op, path: op.path as string[], ...(op.op === 'set' ? { value: op.value } : {}) })
  }
  if (normalized.length === 0) return undefined
  const expectedRevision = body.expectedRevision
  return {
    ops: normalized,
    ...(typeof expectedRevision === 'number' && Number.isInteger(expectedRevision)
      ? { expectedRevision }
      : {}),
  }
}

/**
 * 同源校验：只在请求**真的带了浏览器来源头**时，判断该来源是否可信。
 *
 * 判定规则：
 * - 来源是桌面版窗口的 `dsh-app:` 协议 → 放行（DSH Desktop 把窗口请求转发给宿主时
 *   **删掉 Origin、保留 Referer**，页面来源与请求 Host 必然不同，不放行则桌面版必 403）；
 * - 来源与请求 Host 匹配 → 放行；
 * - 完全不带来源头 → 放行（宿主进程内部调用、本机脚本）。这类请求伪造任何头都轻而易举，
 *   拒绝它并不构成安全边界；要防本机任意进程读取，需要的是鉴权而不是来源头。
 * - 其它来源 → 拒绝（浏览器跨站请求**一定**带 Origin/Referer，CSRF 由此挡住）。
 */
export function sameOrigin(request: IncomingMessage): boolean {
  const host = request.headers.host
  const origin = request.headers.origin ?? request.headers.referer
  if (origin === undefined) return true
  if (host === undefined) return false
  try {
    const parsed = new URL(origin)
    if (parsed.protocol === 'dsh-app:') return true
    return parsed.host === host
  } catch {
    return false
  }
}

/** 路由访问守卫：返回 401/403 表示拒绝，undefined 表示放行。 */
export type RouteGuard = (request: IncomingMessage) => 401 | 403 | undefined

/**
 * 未注入守卫时的兜底：只看来源头。
 *
 * ⚠️ 这**不是鉴权**（本机任意进程不带来源头即可通过，伪造来源头也轻而易举），
 * 只防浏览器跨站。有宿主连接服务时应传 `ctx.connection.requestRejection`：
 * 它按宿主自己签发的 cookie 判定，能真正挡住本机裸进程，且不看 Origin/Referer
 * —— 桌面壳转发时会删掉 Origin、只留 `referer: dsh-app://app/`，用来源头判定必然误伤。
 */
const fallbackGuard: RouteGuard = (request) => (sameOrigin(request) ? undefined : 403)

/**
 * 执行访问守卫；守卫自身抛错（第三方/自定义 connection 服务）→ **fail closed**。
 *
 * 不用宿主 webserver 兜底的 400：那样从响应上看不出是鉴权环节出的问题
 * （`dsh-host-webserver` 对 handler 抛错只记 warn 并回 400），排障时会误导。
 */
function rejectedBy(
  guard: RouteGuard,
  request: IncomingMessage,
): { status: 401 | 403; error: string } | undefined {
  let rejection: 401 | 403 | undefined
  try {
    rejection = guard(request)
  } catch {
    return { status: 403, error: 'guard failed' }
  }
  if (rejection === undefined) return undefined
  return { status: rejection, error: rejection === 401 ? 'unauthenticated' : 'untrusted origin' }
}

// ---- HTTP 层 ----

function sendJson(res: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(body)
}

/** 读取请求体（限制大小，防滥用）。 */
function readBody(request: IncomingMessage, limit = 64 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let total = 0
    request.on('data', (chunk: Buffer) => {
      total += chunk.length
      if (total > limit) {
        reject(new Error('payload too large'))
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    request.on('error', reject)
  })
}

function handleGet(
  settings: SettingsServiceLike,
  res: ServerResponse,
  namespace: string,
  effective: (value: unknown, user: unknown) => unknown,
): void {
  sendJson(res, 200, configViewOf(settings, namespace, effective))
}

async function handlePost(
  settings: SettingsServiceLike,
  request: IncomingMessage,
  res: ServerResponse,
  namespace: string,
): Promise<void> {
  let raw: unknown
  try {
    raw = JSON.parse(await readBody(request))
  } catch {
    sendJson(res, 400, { ok: false, error: 'invalid JSON body' })
    return
  }
  const body = parseConfigWriteBody(raw)
  if (body === undefined) {
    sendJson(res, 400, { ok: false, error: 'invalid ops' })
    return
  }
  try {
    await settings.mutate(namespace, body.ops as SettingsPathOp[], body.expectedRevision)
    sendJson(res, 200, { ok: true })
  } catch (error) {
    sendJson(res, 409, {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * 挂载配置路由（webServer 服务可用时调用）。
 * @param webServer - webServer 服务（窄接口）。
 * @param settings - settings 服务（窄接口）。
 * @param namespace - 本插件在 profile 中的条目 id（settings 命名空间）。
 * @returns 卸载函数。
 */
export function mountConfigRoutes(
  webServer: WebServerLike,
  settings: SettingsServiceLike,
  namespace: string = CONFIG_NAMESPACE,
  guard: RouteGuard = fallbackGuard,
  effective: (value: unknown, user: unknown) => unknown = value => value,
): () => void {
  const routes: WebRoute[] = [
    {
      kind: 'exact',
      path: '/dsh-messager/config',
      handler: (request, response) => {
        // 访问守卫（GET / POST / 其它方法一致）：默认来源校验；调用方注入宿主连接服务时
        // 走官方鉴权正门（cookie 判定），桌面壳转发与浏览器页面都能通过。
        const denied = rejectedBy(guard, request)
        if (denied !== undefined) {
          sendJson(response, denied.status, { ok: false, error: denied.error })
          return
        }
        if (request.method === 'GET') {
          handleGet(settings, response, namespace, effective)
          return
        }
        if (request.method === 'POST') {
          return handlePost(settings, request, response, namespace)
        }
        response.writeHead(405, { allow: 'GET, POST' })
        response.end()
      },
    },
  ]
  const disposers = routes.map(route => webServer.register(route))
  return () => {
    for (const dispose of disposers) dispose()
  }
}
