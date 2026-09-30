import { describe, expect, it, vi } from 'vitest'
import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  configViewOf, mountConfigRoutes, parseConfigWriteBody, sameOrigin,
  CONFIG_NAMESPACE, type RouteGuard, type SettingsServiceLike, type WebServerLike,
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

/** 挂载路由并返回唯一的 handler（可注入访问守卫与有效值变换）。 */
function mountedHandler(
  service: SettingsServiceLike,
  guard?: RouteGuard,
  effective?: (value: unknown, user: unknown) => unknown,
) {
  const { webServer, routes } = fakeWebServer()
  mountConfigRoutes(webServer, service, CONFIG_NAMESPACE, guard, effective)
  const route = routes.find(candidate => candidate.path === '/dsh-messager/config')
  expect(route).toBeDefined()
  return route!.handler
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
    expect(sameOrigin(request('http://127.0.0.1:3080'))).toBe(true)
  })

  it('桌面版窗口来源（dsh-app:）→ 放行：壳转发时删 Origin、只留 Referer', () => {
    // DSH Desktop 的 forwardWebRequest 会删掉 origin/host/cookie，referer 原样透传
    expect(sameOrigin(request(undefined, 'dsh-app://app/'))).toBe(true)
    expect(sameOrigin(request('dsh-app://app'))).toBe(true)
  })

  it('跨源 → 拒绝', () => {
    expect(sameOrigin(request('https://evil.example'))).toBe(false)
    expect(sameOrigin(request('http://127.0.0.1:3081'))).toBe(false)
  })

  it('无来源头 → 放行（宿主内部调用/本机脚本；来源头本就不构成本机安全边界）', () => {
    expect(sameOrigin(request())).toBe(true)
  })

  it('来源头非法（无法解析成 URL）→ 拒绝', () => {
    expect(sameOrigin(request('not-a-url'))).toBe(false)
  })
})

describe('访问守卫（宿主连接服务鉴权）', () => {
  it('guard 返回 401 → GET/POST 一律拒绝，且不触碰 settings', async () => {
    const { service, describe: describeFn, mutate } = fakeSettings(descriptor)
    const handler = mountedHandler(service, () => 401)
    for (const method of ['GET', 'POST']) {
      const payload = method === 'POST'
        ? JSON.stringify({ ops: [{ op: 'set', path: ['feishu', 'enabled'], value: true }] })
        : undefined
      const { res, status, body } = fakeResponse()
      await handler(fakeRequest(method, {}, payload), res)
      expect(status()).toBe(401)
      expect(JSON.parse(body())).toEqual({ ok: false, error: 'unauthenticated' })
    }
    expect(describeFn).not.toHaveBeenCalled()
    expect(mutate).not.toHaveBeenCalled()
  })

  it('guard 返回 403 → untrusted origin', async () => {
    const { service } = fakeSettings(descriptor)
    const handler = mountedHandler(service, () => 403)
    const { res, status, body } = fakeResponse()
    await handler(fakeRequest('GET', {}), res)
    expect(status()).toBe(403)
    expect(JSON.parse(body())).toEqual({ ok: false, error: 'untrusted origin' })
  })

  it('guard 自身抛错 → fail closed（403 guard failed，而不是宿主兜底的 400）', async () => {
    const { service, mutate } = fakeSettings(descriptor)
    const handler = mountedHandler(service, () => { throw new Error('connection service exploded') })
    const { res, status, body } = fakeResponse()
    await handler(fakeRequest('POST', {}, '{"ops":[]}'), res)
    expect(status()).toBe(403)
    expect(JSON.parse(body())).toEqual({ ok: false, error: 'guard failed' })
    expect(mutate).not.toHaveBeenCalled()
  })

  it('guard 也覆盖非 GET/POST 方法（拒绝优先于 405）', async () => {
    const { service } = fakeSettings(descriptor)
    const handler = mountedHandler(service, () => 401)
    const { res, status } = fakeResponse()
    await handler(fakeRequest('DELETE', {}), res)
    expect(status()).toBe(401)
  })

  it('guard 放行时收到原始请求（可交给 ctx.connection.requestRejection）', async () => {
    const { service } = fakeSettings(descriptor)
    const seen: Array<string | undefined> = []
    const handler = mountedHandler(service, (request) => {
      seen.push(request.headers.host)
      return undefined
    })
    const { res, status } = fakeResponse()
    await handler(fakeRequest('GET', {}), res)
    expect(status()).toBe(200)
    expect(seen).toEqual(['127.0.0.1:3080'])
  })

  it('未注入守卫时退回来源校验：跨源 POST 仍 403', async () => {
    const { service, mutate } = fakeSettings(descriptor)
    const handler = mountedHandler(service)
    const { res, status } = fakeResponse()
    await handler(fakeRequest('POST', { origin: 'https://evil.example' }, '{}'), res)
    expect(status()).toBe(403)
    expect(mutate).not.toHaveBeenCalled()
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

  it('GET 的有效值经变换（设置页显示 host 实际使用的值），user/base 保持原样', async () => {
    const { service } = fakeSettings(descriptor)
    const handler = mountedHandler(service, undefined, (value, user) => ({
      ...(value as Record<string, unknown>),
      system: { enabled: false }, // 模拟环境默认值（桌面宿主）
      seenUser: user,
    }))
    const { res, status, body } = fakeResponse()
    await handler(fakeRequest('GET', {}), res)
    const view = JSON.parse(body()) as { value: Record<string, unknown>; user: unknown }
    expect(status()).toBe(200)
    expect(view.value).toMatchObject({ system: { enabled: false } })
    expect(view.value.seenUser).toEqual({ triggers: { interaction: false } })
    expect(view.user).toEqual({ triggers: { interaction: false } })
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

  it('POST 桌面版窗口转发形态（Origin 被壳删除、Referer=dsh-app://app/）→ 200', async () => {
    // 回归用例（v0.3.6）：桌面版设置页保存曾因来源判定返回 403 untrusted origin
    const { service, mutate } = fakeSettings(descriptor)
    const handler = mountedHandler(service)
    const { res, status } = fakeResponse()
    await handler(fakeRequest('POST', { referer: 'dsh-app://app/' }, JSON.stringify({
      ops: [{ op: 'set', path: ['feishu', 'enabled'], value: true }],
    })), res)
    expect(status()).toBe(200)
    expect(mutate).toHaveBeenCalled()
  })

  it('POST 无任何来源头（宿主内部/本机调用）→ 200', async () => {
    const { service, mutate } = fakeSettings(descriptor)
    const handler = mountedHandler(service)
    const { res, status } = fakeResponse()
    await handler(fakeRequest('POST', {}, JSON.stringify({
      ops: [{ op: 'set', path: ['feishu', 'enabled'], value: true }],
    })), res)
    expect(status()).toBe(200)
    expect(mutate).toHaveBeenCalled()
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
