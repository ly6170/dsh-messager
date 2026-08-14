import { describe, expect, it, vi } from 'vitest'
import {
  CARD_FIELDS, MessagerCardController, deepEqualJson, isFieldGated,
  type ScopeLike, type ScopeWriteOp,
} from '../src/client/card-controller.ts'

/** 服务端语义：嵌套 set/unset，set 沿路径替换（与 DSH applyPathOp 同构）。 */
function applyPathOp(section: Record<string, unknown>, op: ScopeWriteOp): Record<string, unknown> {
  const [head, ...rest] = op.path
  if (head === undefined) {
    if (op.op === 'unset') return {}
    return { ...(op.value as Record<string, unknown>) }
  }
  if (rest.length === 0) {
    if (op.op === 'set') return { ...section, [head]: op.value }
    const { [head]: _removed, ...kept } = section
    return kept
  }
  const child = section[head]
  if (typeof child !== 'object' || child === null || Array.isArray(child)) {
    if (op.op === 'unset') return section
    return { ...section, [head]: applyPathOp({}, { ...op, path: rest }) }
  }
  return { ...section, [head]: applyPathOp(child as Record<string, unknown>, { ...op, path: rest }) }
}

/** 浅-深合并（模拟服务端 默认值 → base → 用户层 的层叠）。 */
function mergeLayers(under: unknown, over: unknown): Record<string, unknown> {
  const base = (typeof under === 'object' && under !== null && !Array.isArray(under) ? under : {}) as Record<string, unknown>
  const patch = (typeof over === 'object' && over !== null && !Array.isArray(over) ? over : {}) as Record<string, unknown>
  const out: Record<string, unknown> = { ...base }
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue
    const existing = base[key]
    out[key] = typeof existing === 'object' && existing !== null && !Array.isArray(existing)
      && typeof value === 'object' && value !== null && !Array.isArray(value)
      ? mergeLayers(existing, value)
      : value
  }
  return out
}

/** 模拟服务端脱敏：任意深度移除键名为 secret 的字段。 */
function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact)
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (key === 'secret') continue
      out[key] = redact(entry)
    }
    return out
  }
  return value
}

/**
 * 可编程的假 scope（模拟 SettingsScope + 服务端 mutate 语义）：
 * - writeOps 按嵌套路径写「存储层」，修订号 +1，回显脱敏后的 value/user；
 * - rawUser 暴露未脱敏的存储层，供断言密钥等 write-only 字段是否真的落库。
 */
function fakeScope(initial: {
  status?: string
  value?: unknown
  user?: unknown
  base?: unknown
  writable?: boolean
} = {}): ScopeLike & {
  state(): {
    value: Record<string, unknown>
    user: Record<string, unknown>
    base: unknown
    rawUser: Record<string, unknown>
    revision: number
  }
} {
  const base = initial.base ?? initial.value ?? {}
  let stored = structuredClone((initial.user ?? {}) as Record<string, unknown>)
  const state = {
    status: initial.status ?? 'ready',
    value: structuredClone((initial.value ?? mergeLayers(base, stored)) as Record<string, unknown>),
    user: redact(stored) as Record<string, unknown>,
    base,
    rawUser: stored,
    writable: initial.writable ?? true,
    revision: 0,
  }
  const listeners = new Set<() => void>()
  const notify = () => {
    for (const listener of [...listeners]) listener()
  }
  const recompute = () => {
    // 服务端对 value/base/user 三层都脱敏（redactSecrets）
    state.user = redact(stored) as Record<string, unknown>
    state.value = redact(mergeLayers(state.base, stored)) as Record<string, unknown>
    state.rawUser = stored
  }
  const scope: ScopeLike & {
    state(): typeof state
  } = {
    state: () => state,
    getSnapshot: () => state,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    async set(field: string, value: unknown) {
      await this.writeOps([{ op: 'set', path: [field], value }])
    },
    async unset(field: string) {
      await this.writeOps([{ op: 'unset', path: [field] }])
    },
    async writeOps(ops) {
      let section = structuredClone(stored)
      for (const op of ops) section = applyPathOp(section, op)
      stored = section
      state.revision += 1
      recompute()
      notify()
      return true
    },
  }
  return scope
}

/** 控制器 + 注入面快照助手。 */
function makeController(scope: ScopeLike) {
  const controller = new MessagerCardController(scope, CARD_FIELDS)
  const face = controller.inject()
  const snapshot = () => face.hooks.messagerCard.getSnapshot()
  return { controller, face, snapshot }
}

const baseConfig = {
  triggers: { interaction: true, completed: true, error: true },
  system: { enabled: true, verbosity: 'normal' },
  browser: { enabled: true, onlyWhenHidden: true, verbosity: 'normal' },
  feishu: { enabled: false, timeoutMs: 5000, verbosity: 'normal' },
  message: { includeSessionTitle: true, guiUrl: 'http://127.0.0.1:3080' },
}

describe('MessagerCardController', () => {
  it('初始状态：可用、可写、无编辑、字段反映生效值', () => {
    const scope = fakeScope({ value: baseConfig })
    const { snapshot } = makeController(scope)
    const state = snapshot()
    expect(state.available).toBe(true)
    expect(state.writable).toBe(true)
    expect(state.dirty).toBe(false)
    expect(state.fields['triggers.interaction']).toEqual({ text: 'true', overridden: false, invalid: false })
    expect(state.fields['feishu.timeoutMs']).toEqual({ text: '5000', overridden: false, invalid: false })
  })

  it('不可用/只读时反映状态', () => {
    const unavailable = fakeScope({ status: 'loading' })
    expect(makeController(unavailable).snapshot().available).toBe(false)
    const readonly = fakeScope({ value: baseConfig, writable: false })
    expect(makeController(readonly).snapshot().writable).toBe(false)
  })

  it('编辑 toggle → 保存：逐字段写入用户层，不整组替换', async () => {
    const scope = fakeScope({ value: baseConfig })
    const { face, snapshot } = makeController(scope)
    face.edit('triggers', 'interaction', 'false')
    expect(snapshot().dirty).toBe(true)
    face.save()
    await vi.waitFor(() => expect(snapshot().saving).toBe(false))
    expect(snapshot().failed).toBe(false)
    // 只写被编辑的字段；组内其他字段仍来自基值
    expect(scope.state().rawUser).toEqual({ triggers: { interaction: false } })
    expect(scope.state().value).toMatchObject({ triggers: { interaction: false, completed: true, error: true } })
    expect(snapshot().fields['triggers.interaction'].overridden).toBe(true)
    expect(snapshot().dirty).toBe(false)
  })

  it('非法数字草稿阻止保存', async () => {
    // feishu 开启后 timeoutMs 才参与保存计划（门控字段）
    const scope = fakeScope({ value: { ...baseConfig, feishu: { ...baseConfig.feishu, enabled: true } } })
    const { face, snapshot } = makeController(scope)
    face.edit('feishu', 'timeoutMs', 'abc')
    const state = snapshot()
    expect(state.fields['feishu.timeoutMs'].invalid).toBe(true)
    expect(state.invalid).toBe(true)
    face.save()
    await vi.waitFor(() => expect(snapshot().saving).toBe(false))
    expect(scope.state().rawUser).toEqual({}) // 未写入
    expect(snapshot().dirty).toBe(true)
  })

  it('重置字段：保存后从用户层移除该键', async () => {
    const scope = fakeScope({
      value: { ...baseConfig, message: { ...baseConfig.message, titlePrefix: '前缀' } },
      user: { message: { titlePrefix: '前缀' } },
      base: baseConfig,
    })
    const { face, snapshot } = makeController(scope)
    expect(snapshot().fields['message.titlePrefix'].overridden).toBe(true)
    face.reset('message', 'titlePrefix')
    expect(snapshot().dirty).toBe(true)
    face.save()
    await vi.waitFor(() => expect(snapshot().saving).toBe(false))
    const value = scope.state().value as { message: Record<string, unknown> }
    expect(Object.hasOwn(value.message, 'titlePrefix')).toBe(false) // 重置 = 移除该键
    expect(value.message.guiUrl).toBe('http://127.0.0.1:3080')
    expect(Object.hasOwn(scope.state().user as Record<string, unknown>, 'message')).toBe(true)
    expect(scope.state().user.message).toEqual({})
  })

  it('secret 字段：留空不写入；填入则写入且不误报失败', async () => {
    // feishu 开启后 secret 才参与保存计划（门控字段）
    const feishuOn = { ...baseConfig, feishu: { ...baseConfig.feishu, enabled: true } }
    const scope = fakeScope({ value: feishuOn, base: feishuOn })
    const { face, snapshot } = makeController(scope)
    // 留空编辑（空字符串）→ 无脏编辑
    face.edit('feishu', 'secret', '')
    expect(snapshot().dirty).toBe(false)
    // 填入 → 写入
    face.edit('feishu', 'secret', 's3cret')
    expect(snapshot().dirty).toBe(true)
    face.save()
    await vi.waitFor(() => expect(snapshot().saving).toBe(false))
    // 关键回归：服务端不回显密钥（脱敏），保存不得误报失败、草稿必须清空
    expect(snapshot().failed).toBe(false)
    expect(snapshot().dirty).toBe(false)
    // 存储层确实写入；回显的 value/user 均不含 secret
    expect(scope.state().rawUser).toMatchObject({ feishu: { secret: 's3cret' } })
    expect(scope.state().value.feishu).not.toHaveProperty('secret')
    expect(scope.state().user.feishu).not.toHaveProperty('secret')
  })

  it('修改 feishu 字段不重输密钥：已存密钥不被整组替换抹掉', async () => {
    const stored = { feishu: { enabled: true, webhookUrl: 'https://old', secret: 'old' } }
    const scope = fakeScope({
      value: { ...baseConfig, feishu: { ...baseConfig.feishu, enabled: true, webhookUrl: 'https://old' } },
      user: stored,
      base: baseConfig,
    })
    const { face, snapshot } = makeController(scope)
    face.edit('feishu', 'webhookUrl', 'https://new')
    expect(snapshot().dirty).toBe(true)
    face.save()
    await vi.waitFor(() => expect(snapshot().saving).toBe(false))
    expect(snapshot().failed).toBe(false)
    // 只写了 webhookUrl 一条 op；已存密钥原样保留
    expect(scope.state().rawUser).toMatchObject({ feishu: { webhookUrl: 'https://new', secret: 'old' } })
  })

  it('重置密钥：显式 unset 清除已存密钥', async () => {
    const stored = { feishu: { enabled: true, secret: 'old' } }
    const scope = fakeScope({
      value: { ...baseConfig, feishu: { ...baseConfig.feishu, enabled: true } },
      user: stored,
      base: baseConfig,
    })
    const { face, snapshot } = makeController(scope)
    face.reset('feishu', 'secret')
    expect(snapshot().dirty).toBe(true)
    face.save()
    await vi.waitFor(() => expect(snapshot().saving).toBe(false))
    expect(scope.state().rawUser).toEqual({ feishu: { enabled: true } })
    expect(Object.hasOwn(scope.state().rawUser.feishu, 'secret')).toBe(false)
  })

  it('放弃修改清空草稿', () => {
    const scope = fakeScope({ value: baseConfig })
    const { face, snapshot } = makeController(scope)
    face.edit('system', 'verbosity', 'detailed')
    expect(snapshot().dirty).toBe(true)
    face.discard()
    expect(snapshot().dirty).toBe(false)
    expect(snapshot().fields['system.verbosity'].text).toBe('normal')
  })

  it('无实际变化的编辑不产生保存计划', () => {
    const scope = fakeScope({ value: baseConfig })
    const { face, snapshot } = makeController(scope)
    face.edit('system', 'verbosity', 'normal') // 与生效值相同
    expect(snapshot().dirty).toBe(false)
  })

  it('scope 外部变更（其他标签/设置文档）刷新字段', () => {
    const scope = fakeScope({ value: baseConfig })
    const { face, snapshot } = makeController(scope)
    void scope.set('system', { enabled: false, verbosity: 'detailed' })
    expect(snapshot().fields['system.enabled'].text).toBe('false')
    expect(snapshot().fields['system.verbosity'].text).toBe('detailed')
  })

  it('getSnapshot 未变化时返回同一引用（useSyncExternalStore 契约，防 React #185）', () => {
    const scope = fakeScope({ value: baseConfig })
    const { face } = makeController(scope)
    const first = face.hooks.messagerCard.getSnapshot()
    const second = face.hooks.messagerCard.getSnapshot()
    expect(second).toBe(first)
    face.edit('system', 'verbosity', 'detailed') // 变更后重建
    const third = face.hooks.messagerCard.getSnapshot()
    expect(third).not.toBe(first)
    expect(face.hooks.messagerCard.getSnapshot()).toBe(third)
  })

  describe('门控（hiddenUnless）', () => {
    it('开关关闭时：子配置草稿不产生保存计划（dirty=false）', () => {
      const scope = fakeScope({ value: baseConfig }) // feishu.enabled = false
      const { face, snapshot } = makeController(scope)
      face.edit('feishu', 'webhookUrl', 'https://x')
      expect(snapshot().dirty).toBe(false) // 门控关闭，草稿被计划跳过
    })

    it('开关开启时：子配置可编辑并保存', async () => {
      const scope = fakeScope({ value: { ...baseConfig, feishu: { ...baseConfig.feishu, enabled: true } } })
      const { face, snapshot } = makeController(scope)
      face.edit('feishu', 'webhookUrl', 'https://x')
      expect(snapshot().dirty).toBe(true)
      face.save()
      await vi.waitFor(() => expect(snapshot().saving).toBe(false))
      expect(scope.state().value).toMatchObject({ feishu: { enabled: true, webhookUrl: 'https://x' } })
    })

    it('草稿把开关改为关闭时：同组其他草稿不参与保存', async () => {
      const scope = fakeScope({ value: { ...baseConfig, feishu: { ...baseConfig.feishu, enabled: true } } })
      const { face, snapshot } = makeController(scope)
      face.edit('feishu', 'enabled', 'false')
      face.edit('feishu', 'webhookUrl', 'https://x')
      expect(snapshot().dirty).toBe(true) // 只有开关本身是有效编辑
      face.save()
      await vi.waitFor(() => expect(snapshot().saving).toBe(false))
      const value = scope.state().value as { feishu: Record<string, unknown> }
      expect(value.feishu.enabled).toBe(false)
      expect(value.feishu.webhookUrl).toBeUndefined() // 门控字段未写入
    })

    it('isFieldGated：按当前字段状态判断渲染可见性', () => {
      const gated = CARD_FIELDS.find(spec => spec.field === 'webhookUrl')
      expect(gated?.hiddenUnless).toEqual({ group: 'feishu', field: 'enabled' })
      expect(isFieldGated(gated!, { 'feishu.enabled': { text: 'false', overridden: false, invalid: false } })).toBe(true)
      expect(isFieldGated(gated!, { 'feishu.enabled': { text: 'true', overridden: false, invalid: false } })).toBe(false)
      const plain = CARD_FIELDS.find(spec => spec.field === 'interaction')
      expect(isFieldGated(plain!, {})).toBe(false)
    })
  })
})

describe('deepEqualJson', () => {
  it('结构相等与不等', () => {
    expect(deepEqualJson({ a: 1, b: [1, 2] }, { a: 1, b: [1, 2] })).toBe(true)
    expect(deepEqualJson({ a: 1 }, { a: 2 })).toBe(false)
    expect(deepEqualJson({ a: 1 }, { a: 1, b: 2 })).toBe(false)
    expect(deepEqualJson(null, null)).toBe(true)
    expect(deepEqualJson(1, 1)).toBe(true)
  })
})
