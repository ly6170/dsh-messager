import { describe, expect, it, vi } from 'vitest'
import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  configViewOf, mountConfigRoutes, parseConfigWriteBody, sameOrigin,
  CONFIG_NAMESPACE, type SettingsServiceLike, type WebServerLike,
} from '../src/config-route.ts'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'

/** 假 settings 服务。 */
function fakeSettings(descriptor?: {
  ns: unknown
  value: unknown
  revision: number
  base?: unknown
  user?: unknown
}) {
  const describe = vi.fn(() => descriptor === undefined ? [] : [descriptor])
  const mutate = vi.fn(async () => undefined)
  return {
    service: { writable: true, describe, mutate } as unknown as SettingsServiceLike,
    describe,
    mutate,
  }
}

/** 假 webServer：捕获注册的路由。 */
function fakeWebServer() {
  const routes: WebRoute[] = []
  return {
    webServer: {
      register(route: WebRoute) {
        routes.push(route)
        return () => undefined
      },
    } as WebServerLike,
    routes,
  }
}

/** 假响应：捕获状态码与 body。 */
function fakeResponse() {
  let status = 200
  let body = ''
  const res = {
    writeHead(code: number) { status = code },
    end(payload?: string) { body = payload ?? '' },
  } as unknown as ServerResponse
  return { res, status: () => status, body: () => body }
}

/** 假请求（GET 或带 body 的 POST；真实请求必带 Host 头）。 */
function fakeRequest(method: string, headers: Record<string, string>, body?: string): IncomingMessage {
  const stream = new Readable({ read() {} })
  stream.headers = { host: '127.0.0.1:3080', ...headers }
  stream.method = method
  stream.url = '/dsh-messager/config'
  if (body !== undefined) stream.push(body)
  stream.push(null)
  return stream as unknown as IncomingMessage
}

const descriptor = {
  ns: CONFIG_NAMESPACE,
  value: { triggers: { interaction: true } },
  revision: 3,
  user: { triggers: { interaction: false } },
  base: undefined,
}

/** 挂载路由并返回唯一的 handler。 */
function mountedHandler(service: SettingsServiceLike) {
  const { webServer, routes } = fakeWebServer()
  mountConfigRoutes(webServer, service)
  expect(routes).toHaveLength(1)
  return routes[0]!.handler
}

describe('configViewOf', () => {
  it('命名空间就绪时映射视图（value/user/base/writable/revision）', () => {
    const { service, describe } = fakeSettings(descriptor)
    expect(configViewOf(service)).toEqual({
      status: 'ready',
      value: { triggers: { interaction: true } },
      user: { triggers: { interaction: false } },
      base: undefined,
      writable: true,
      mode: 'host',
      revision: 3,
    })
    expect(describe).toHaveBeenCalledWith({ redactSecrets: true })
  })

  it('命名空间缺失 → unavailable', () => {
    const { service } = fakeSettings()
    const view = configViewOf(service)
    expect(view.status).toBe('unavailable')
    expect(view.writable).toBe(true)
  })
})

describe('parseConfigWriteBody', () => {
  it('接受逐字段 ops（含 expectedRevision）', () => {
    expect(parseConfigWriteBody({
      ops: [{ op: 'set', path: ['feishu', 'enabled'], value: true }],
      expectedRevision: 3,
    })).toEqual({
      ops: [{ op: 'set', path: ['feishu', 'enabled'], value: true }],
      expectedRevision: 3,
    })
    expect(parseConfigWriteBody({
      ops: [{ op: 'unset', path: ['feishu', 'secret'] }],
    })).toEqual({ ops: [{ op: 'unset', path: ['feishu', 'secret'] }] })
  })

  it('拒绝非法输入', () => {
    expect(parseConfigWriteBody(null)).toBeUndefined()
    expect(parseConfigWriteBody({ ops: [] })).toBeUndefined()
    expect(parseConfigWriteBody({ ops: [{ op: 'bogus', path: ['a'] }] })).toBeUndefined()
    expect(parseConfigWriteBody({ ops: [{ op: 'set', path: [] }] })).toBeUndefined()
    expect(parseConfigWriteBody({ ops: [{ op: 'set', path: ['a'], value: 1 }, { op: 'set' }] })).toBeUndefined()
    expect(parseConfigWriteBody({ ops: [{ op: 'unset', path: [''] }] })).toBeUndefined()
  })
})

describe('sameOrigin', () => {
  const request = (origin?: string, referer?: string) => ({
    headers: {
      host: '127.0.0.1:3080',
      ...(origin === undefined ? {} : { origin }),
      ...(referer === undefined ? {} : { referer }),
    },
  }) as unknown as IncomingMessage

  it('Origin 与 Host 匹配 → 放行', () => {
    expect(sameOrigin(request('http://127.0.0.1:3080'), true)).toBe(true)
  })

  it('跨源 → 拒绝', () => {
    expect(sameOrigin(request('https://evil.example'), true)).toBe(false)
    expect(sameOrigin(request('http://127.0.0.1:3081'), true)).toBe(false)
  })

  it('无来源头：requireOrigin=false（GET）放行；true（POST）拒绝', () => {
    expect(sameOrigin(request(), false)).toBe(true)
    expect(sameOrigin(request(), true)).toBe(false)
  })
})

describe('mountConfigRoutes（HTTP 层）', () => {
  it('GET → 200 + 配置视图', async () => {
    const { service } = fakeSettings(descriptor)
    const handler = mountedHandler(service)
    const { res, status, body } = fakeResponse()
    await handler(fakeRequest('GET', {}), res)
    expect(status()).toBe(200)
    expect(JSON.parse(body())).toMatchObject({ status: 'ready', revision: 3 })
  })

  it('POST 合法 ops → settings.mutate 收到规范化 ops 与 expectedRevision', async () => {
    const { service, mutate } = fakeSettings(descriptor)
    const handler = mountedHandler(service)
    const { res, status } = fakeResponse()
    await handler(fakeRequest('POST', { origin: 'http://127.0.0.1:3080' }, JSON.stringify({
      ops: [{ op: 'set', path: ['feishu', 'enabled'], value: true }],
      expectedRevision: 3,
    })), res)
    expect(status()).toBe(200)
    expect(mutate).toHaveBeenCalledWith(
      CONFIG_NAMESPACE,
      [{ op: 'set', path: ['feishu', 'enabled'], value: true }],
      3,
    )
  })

  it('POST 跨源 → 403 且不触碰 settings', async () => {
    const { service, mutate } = fakeSettings(descriptor)
    const handler = mountedHandler(service)
    const { res, status } = fakeResponse()
    await handler(fakeRequest('POST', { origin: 'https://evil.example' }, '{}'), res)
    expect(status()).toBe(403)
    expect(mutate).not.toHaveBeenCalled()
  })

  it('POST 坏 JSON / 非法 ops → 400', async () => {
    const { service, mutate } = fakeSettings(descriptor)
    const handler = mountedHandler(service)
    for (const payload of ['not-json', JSON.stringify({ ops: [] })]) {
      const { res, status } = fakeResponse()
      await handler(fakeRequest('POST', { origin: 'http://127.0.0.1:3080' }, payload), res)
      expect(status()).toBe(400)
    }
    expect(mutate).not.toHaveBeenCalled()
  })

  it('mutate 抛错（如 revision 冲突）→ 409 + 错误信息', async () => {
    const { service, mutate } = fakeSettings(descriptor)
    mutate.mockRejectedValueOnce(new Error('settings conflict'))
    const handler = mountedHandler(service)
    const { res, status, body } = fakeResponse()
    await handler(fakeRequest('POST', { origin: 'http://127.0.0.1:3080' }, JSON.stringify({
      ops: [{ op: 'set', path: ['a'], value: 1 }],
    })), res)
    expect(status()).toBe(409)
    expect(JSON.parse(body())).toEqual({ ok: false, error: 'settings conflict' })
  })

  it('非 GET/POST → 405', async () => {
    const { service } = fakeSettings(descriptor)
    const handler = mountedHandler(service)
    const { res, status } = fakeResponse()
    await handler(fakeRequest('DELETE', {}), res)
    expect(status()).toBe(405)
  })
})
