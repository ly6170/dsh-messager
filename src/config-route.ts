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
 * 安全：POST 要求同源（Origin/Referer 与 Host 匹配）；响应不带 CORS 头，
 * 跨站 JS 无法读取；GET 只读无副作用。
 * 密钥：describe({ redactSecrets: true }) 自动脱敏，写入方向与设置页一致。
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { settingsNamespace, type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import type { SettingsPathOp } from '@deepseek-ai/dsh-settings'
import type { ConfigView, ConfigWriteBody } from './config-shared.js'

/** 命名空间（与 host 注册一致）。 */
export const CONFIG_NAMESPACE = settingsNamespace('messager')

export type { ConfigView, ConfigWriteBody } from './config-shared.js'

/** 路由依赖的 settings 服务窄接口（便于测试替身）。 */
export interface SettingsServiceLike {
  readonly writable: boolean
  describe(options?: { redactSecrets?: boolean }): ReadonlyArray<{
    ns: SettingsNamespace
    value: unknown
    revision: number
    base?: unknown
    user?: unknown
  }>
  mutate(ns: SettingsNamespace, ops: readonly SettingsPathOp[], expectedRevision?: number): Promise<void>
}

/** 路由注册的宿主（webServer 服务窄接口）。 */
export interface WebServerLike {
  register(route: WebRoute): () => void
}

// ---- 纯逻辑（可单测） ----

/** 把 settings 描述符映射为 client 视图；命名空间缺失 → unavailable。 */
export function configViewOf(settings: SettingsServiceLike): ConfigView {
  const descriptor = settings.describe({ redactSecrets: true }).find(candidate => candidate.ns === CONFIG_NAMESPACE)
  if (descriptor === undefined) {
    return { status: 'unavailable', value: undefined, user: undefined, base: undefined, writable: settings.writable, mode: 'host' }
  }
  return {
    status: 'ready',
    value: descriptor.value,
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
 * 同源校验：Origin/Referer 存在时必须与请求 Host 匹配。
 * POST 无来源头一律拒绝（纵深防御；跨站表单/fetch 都会被 CORS 挡在读之外）。
 */
export function sameOrigin(request: IncomingMessage, requireOrigin: boolean): boolean {
  const host = request.headers.host
  const origin = request.headers.origin ?? request.headers.referer
  if (origin === undefined) return !requireOrigin
  if (host === undefined) return false
  try {
    const parsed = new URL(origin)
    return parsed.host === host
  } catch {
    return false
  }
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

function handleGet(settings: SettingsServiceLike, res: ServerResponse): void {
  sendJson(res, 200, configViewOf(settings))
}

async function handlePost(
  settings: SettingsServiceLike,
  request: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (!sameOrigin(request, true)) {
    sendJson(res, 403, { ok: false, error: 'untrusted origin' })
    return
  }
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
    await settings.mutate(CONFIG_NAMESPACE, body.ops as SettingsPathOp[], body.expectedRevision)
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
 * @returns 卸载函数。
 */
export function mountConfigRoutes(webServer: WebServerLike, settings: SettingsServiceLike): () => void {
  const routes: WebRoute[] = [
    {
      kind: 'exact',
      path: '/dsh-messager/config',
      handler: (request, response) => {
        if (request.method === 'GET') {
          handleGet(settings, response)
          return
        }
        if (request.method === 'POST') {
          return handlePost(settings, request, response)
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
