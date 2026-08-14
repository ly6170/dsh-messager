/**
 * 设置页卡片：字段清单与表单控制器（纯逻辑，可单测）。
 *
 * 配置为嵌套结构，而客户端 SettingsScope 的 set/unset 只支持单层路径写，
 * 因此保存走 scope.writeOps：把每个草稿翻译为一条「嵌套路径」写操作
 * （set/unset path: ['group', 'field']），由适配层直连 settings RPC。
 *
 * 为什么不用「整组合并 set」：mutate 的 set 是**整组替换**语义——
 * 1) 服务端回显脱敏（write-only 密钥永不回显），写后校验必然误报失败；
 * 2) 合并对象不含密钥时，已存的密钥会被静默抹掉。
 * 逐字段路径写则只在显式填写/重置密钥时才触碰它，其余字段互不牵连。
 *
 * feishu.secret 为 write-only（服务端会脱敏，响应永不携带其值）：
 * - 输入框留空 = 不修改；填入并保存 = 写入；
 * - 点「重置」= 发出 unset 清除已存密钥。
 */

import type { SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'

/** 字段控件类型。 */
export type CardFieldKind = 'toggle' | 'text' | 'number' | 'select'

/** 门控：仅当指定组内开关字段生效值为 true 时，该字段才可编辑/可见。 */
export interface FieldHiddenUnless {
  group: string
  field: string
}

/** 一个可编辑字段（位于某个顶层配置组内）。 */
export interface CardFieldSpec {
  /** 顶层组：config 的一级键，同时是 scope 的标量字段名。 */
  group: string
  /** 组内字段名。 */
  field: string
  kind: CardFieldKind
  label: string
  hint?: string
  /** select 的选项。 */
  options?: readonly string[]
  /** write-only 字段（secret）：响应永不携带其值。 */
  secret?: boolean
  /** 门控开关：开关关闭时该字段不可见且保存计划跳过（如第三方通道的子配置）。 */
  hiddenUnless?: FieldHiddenUnless
}

/** 字段渲染状态。 */
export interface CardFieldState {
  /** 草稿文本 / 选中值。 */
  text: string
  /** 保存后是否会产生用户层覆盖。 */
  overridden: boolean
  /** 草稿非法（数字格式错误等），阻止保存。 */
  invalid: boolean
}

/** 卡片状态快照（槽位 hook 的载荷）。 */
export interface MessagerCardState {
  /** 命名空间是否可用（ready）。 */
  available: boolean
  /** 原始 scope 状态（loading/unavailable/ready），供提示区分原因。 */
  status: string
  /** 连接模式（host/memory）；memory = 非 loopback 访问，设置页不可用。 */
  mode: string
  /** 设置文档是否可写。 */
  writable: boolean
  /** 是否存在待保存的编辑。 */
  dirty: boolean
  /** 是否有非法草稿。 */
  invalid: boolean
  saving: boolean
  failed: boolean
  fields: Readonly<Record<string, CardFieldState>>
}

/** 卡片动作（组件直接调用）。 */
export interface MessagerCardActions {
  edit(group: string, field: string, text: string): void
  reset(group: string, field: string): void
  save(): void
  discard(): void
}

/** 槽位注入面：hooks 中的 messagerCard 会变成 useMessagerCard 选择器；动作平铺为组件 props。 */
export interface MessagerCardFace {
  hooks: {
    messagerCard: {
      getSnapshot(): MessagerCardState
      subscribe(listener: () => void): () => void
    }
  }
  edit(group: string, field: string, text: string): void
  reset(group: string, field: string): void
  save(): void
  discard(): void
}

/** 一条嵌套路径写操作（与 settings.mutate 的 SettingsPathOpView 同构）。 */
export type ScopeWriteOp =
  | { op: 'set'; path: string[]; value: unknown }
  | { op: 'unset'; path: string[] }

/** 控制器依赖的 scope 窄接口（便于测试替身）。 */
export interface ScopeLike {
  getSnapshot(): {
    status: string
    value: unknown
    user: unknown
    base: unknown
    writable: boolean
    mode?: string
    /** 命名空间修订号（直连 api 写时作为 expectedRevision 回传）。 */
    revision?: number
  }
  subscribe(listener: () => void): () => void
  set(field: string, value: unknown): Promise<void>
  unset(field: string): Promise<void>
  /** 一次批量嵌套路径写；返回是否落库成功。memory 模式下应静默成功（与 scope 一致）。 */
  writeOps(ops: readonly ScopeWriteOp[]): Promise<boolean>
}

/** 字段键：`group.field`。 */
export function fieldKey(group: string, field: string): string {
  return `${group}.${field}`
}

/**
 * 渲染层门控判断（与控制器 gatedOff 语义一致）：
 * hiddenUnless 指定的开关字段当前（含草稿）不为 true 时，该字段不渲染。
 */
export function isFieldGated(
  spec: CardFieldSpec,
  fields: Readonly<Record<string, CardFieldState>>,
): boolean {
  const gate = spec.hiddenUnless
  if (gate === undefined) return false
  return fields[fieldKey(gate.group, gate.field)]?.text !== 'true'
}

interface StagedEdit {
  text: string
  clear: boolean
}

interface PlannedWrite {
  run?: () => Promise<boolean>
}

/** 把草稿解析为组内值；undefined 表示非法（阻止保存）。 */
function parseDraft(spec: CardFieldSpec, text: string): unknown | undefined {
  const trimmed = text.trim()
  switch (spec.kind) {
    case 'toggle':
      return trimmed === 'true' ? true : trimmed === 'false' ? false : undefined
    case 'select':
      return spec.options?.includes(trimmed) ? trimmed : undefined
    case 'number': {
      if (trimmed === '') return undefined
      const parsed = Number(trimmed)
      return Number.isFinite(parsed) ? parsed : undefined
    }
    case 'text':
      return trimmed
  }
}

/** 把存储值格式化为草稿文本。 */
function formatValue(spec: CardFieldSpec, value: unknown): string {
  if (spec.secret === true) return '' // write-only：永不回显
  if (value === undefined || value === null) return ''
  return String(value)
}

export class MessagerCardController {
  private readonly staged = new Map<string, StagedEdit>()
  private readonly listeners = new Set<() => void>()
  private saving = false
  private failed = false
  private cache: MessagerCardState | null = null

  constructor(
    private readonly scope: ScopeLike,
    private readonly fields: readonly CardFieldSpec[],
  ) {
    scope.subscribe(() => this.invalidate())
  }

  /** 槽位注入面。 */
  inject(): MessagerCardFace {
    return {
      hooks: {
        messagerCard: {
          getSnapshot: () => this.getSnapshot(),
          subscribe: (listener) => {
            this.listeners.add(listener)
            return () => {
              this.listeners.delete(listener)
            }
          },
        },
      },
      edit: (group, field, text) => this.stage(group, field, { text, clear: false }),
      reset: (group, field) => {
        const spec = this.spec(group, field)
        this.stage(group, field, { text: formatValue(spec, this.baseValue(group, field)), clear: true })
      },
      save: () => {
        void this.save()
      },
      discard: () => {
        if (this.staged.size === 0 && !this.failed) return
        this.staged.clear()
        this.failed = false
        this.invalidate()
      },
    }
  }

  /**
   * 读取缓存的快照。
   * 注意：useSyncExternalStore 要求 getSnapshot 在状态未变化时返回**同一引用**，
   * 否则 React 会以 #185（最大更新深度）崩溃 —— 因此快照按变更点惰性计算并缓存，
   * 只有 invalidate() 之后才重建。
   */
  getSnapshot(): MessagerCardState {
    return this.cache ??= this.compute()
  }

  private compute(): MessagerCardState {
    const snapshot = this.scope.getSnapshot()
    const available = snapshot.status === 'ready'
    const fields: Record<string, CardFieldState> = {}
    for (const spec of this.fields) {
      const key = fieldKey(spec.group, spec.field)
      const staged = this.staged.get(key)
      const effective = this.effectiveValue(spec)
      if (staged === undefined) {
        fields[key] = {
          text: formatValue(spec, effective),
          overridden: this.userHas(spec),
          invalid: false,
        }
        continue
      }
      fields[key] = {
        text: staged.text,
        overridden: staged.clear ? false : this.userHas(spec),
        invalid: staged.clear ? false : parseDraft(spec, staged.text) === undefined,
      }
    }
    const plan = this.plan()
    return {
      available,
      status: snapshot.status,
      mode: snapshot.mode ?? '',
      writable: snapshot.writable,
      dirty: plan.length > 0,
      invalid: plan.some(item => item.run === undefined),
      saving: this.saving,
      failed: this.failed,
      fields,
    }
  }

  private effectiveValue(spec: CardFieldSpec): unknown {
    const group = this.groupValue(spec.group)
    if (group === undefined) return undefined
    return group[spec.field]
  }

  private groupValue(group: string): Record<string, unknown> | undefined {
    const value = this.scope.getSnapshot().value
    if (typeof value !== 'object' || value === null) return undefined
    const record = value as Record<string, unknown>
    const section = record[group]
    return typeof section === 'object' && section !== null
      ? section as Record<string, unknown>
      : undefined
  }

  private baseValue(group: string, field: string): unknown {
    const base = this.scope.getSnapshot().base
    if (typeof base !== 'object' || base === null) return undefined
    const section = (base as Record<string, unknown>)[group]
    if (typeof section !== 'object' || section === null) return undefined
    return (section as Record<string, unknown>)[field]
  }

  private userHas(spec: CardFieldSpec): boolean {
    const user = this.scope.getSnapshot().user
    if (typeof user !== 'object' || user === null) return false
    const section = (user as Record<string, unknown>)[spec.group]
    return typeof section === 'object' && section !== null
      && Object.hasOwn(section as Record<string, unknown>, spec.field)
  }

  private stage(group: string, field: string, edit: StagedEdit): void {
    this.staged.set(fieldKey(group, field), edit)
    this.failed = false
    this.invalidate()
  }

  private spec(group: string, field: string): CardFieldSpec {
    const spec = this.fields.find(candidate => candidate.group === group && candidate.field === field)
    if (spec === undefined) throw new Error(`messager card has no field ${group}.${field}`)
    return spec
  }

  /**
   * 计算保存计划：把每个有效草稿翻译为一条嵌套路径写操作。
   * 逐字段而非整组合并：密钥字段只有被显式填写/重置时才生成 op，
   * 其余字段互不牵连（mutate 的 set 是整组替换，合并写会抹掉未回显的密钥）。
   */
  private plan(): PlannedWrite[] {
    const ops: ScopeWriteOp[] = []
    for (const [key, staged] of this.staged) {
      const [group, field] = key.split('.') as [string, string]
      const spec = this.spec(group, field)
      if (this.gatedOff(spec)) continue // 门控关闭：隐藏字段的草稿不参与保存
      if (spec.secret === true && staged.text.trim() === '' && !staged.clear) continue // 留空不修改
      if (staged.clear) {
        // unset 幂等；非密钥字段在用户层没有覆盖时无需操作
        // （密钥无法从脱敏层得知是否已存，总是发出，对未存场景无害）
        if (!spec.secret && !this.userHas(spec)) continue
        ops.push({ op: 'unset', path: [group, field] })
        continue
      }
      const desired = parseDraft(spec, staged.text)
      if (desired === undefined) return [{ run: undefined }] // 任一非法草稿阻塞整个保存
      // 密钥无法与已存值比较（write-only），总是写（幂等）；其余字段无实际变化时跳过
      if (spec.secret !== true && deepEqualJson(desired, this.effectiveValue(spec))) continue
      ops.push({ op: 'set', path: [group, field], value: desired })
    }
    if (ops.length === 0) return []
    const scope = this.scope
    return [{
      run: async () => {
        const ok = await scope.writeOps(ops)
        return ok
      },
    }]
  }

  /**
   * 门控判断：hiddenUnless 指定的开关字段当前（含草稿覆盖）不为 true 时，
   * 该字段不可见、草稿不参与保存。
   */
  gatedOff(spec: CardFieldSpec): boolean {
    const gate = spec.hiddenUnless
    if (gate === undefined) return false
    const gateKey = fieldKey(gate.group, gate.field)
    const gateSpec = this.spec(gate.group, gate.field)
    const staged = this.staged.get(gateKey)
    let gateValue: unknown
    if (staged !== undefined && !staged.clear) {
      gateValue = parseDraft(gateSpec, staged.text)
    } else {
      gateValue = this.effectiveValue(gateSpec)
    }
    return gateValue !== true
  }

  private async save(): Promise<void> {
    const plan = this.plan()
    if (plan.length === 0 || this.saving || plan.some(item => item.run === undefined)) return
    this.saving = true
    this.failed = false
    this.invalidate()
    let landed = true
    for (const item of plan) {
      if (item.run === undefined) continue
      landed = (await item.run()) && landed
    }
    if (landed) this.staged.clear()
    this.saving = false
    this.failed = !landed
    this.invalidate()
  }

  /** 失效缓存并通知订阅者（getSnapshot 下一次调用时重建）。 */
  private invalidate(): void {
    this.cache = null
    for (const listener of [...this.listeners]) listener()
  }
}

/** 深比较 JSON 形状数据（组对象比较）。 */
export function deepEqualJson(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((entry, index) => deepEqualJson(entry, b[index]))
  }
  const left = a as Record<string, unknown>
  const right = b as Record<string, unknown>
  const keys = Object.keys(left)
  if (keys.length !== Object.keys(right).length) return false
  return keys.every(key => key in right && deepEqualJson(left[key], right[key]))
}

/** 设置页卡片展示的字段清单（中文标签）。 */
export const CARD_FIELDS: readonly CardFieldSpec[] = [
  // 触发时机
  { group: 'triggers', field: 'interaction', kind: 'toggle', label: '需要交互时通知' },
  { group: 'triggers', field: 'completed', kind: 'toggle', label: '任务完成时通知' },
  { group: 'triggers', field: 'error', kind: 'toggle', label: '任务出错时通知' },
  // 系统通知
  { group: 'system', field: 'enabled', kind: 'toggle', label: '启用系统通知' },
  { group: 'system', field: 'verbosity', kind: 'select', label: '内容繁复度', options: ['minimal', 'normal', 'detailed'] },
  { group: 'system', field: 'icon', kind: 'text', label: '图标路径', hint: 'node-notifier 需要文件绝对路径' },
  // 浏览器通知
  { group: 'browser', field: 'enabled', kind: 'toggle', label: '启用浏览器通知' },
  { group: 'browser', field: 'onlyWhenHidden', kind: 'toggle', label: '仅页面隐藏时通知' },
  { group: 'browser', field: 'verbosity', kind: 'select', label: '内容繁复度', options: ['minimal', 'normal', 'detailed'] },
  { group: 'browser', field: 'icon', kind: 'text', label: '图标 URL' },
  // 第三方推送（飞书机器人 webhook）：enabled 为门控开关，关闭时不显示/不保存子配置
  { group: 'feishu', field: 'enabled', kind: 'toggle', label: '飞书机器人（webhook）' },
  {
    group: 'feishu', field: 'webhookUrl', kind: 'text', label: 'Webhook 地址',
    hiddenUnless: { group: 'feishu', field: 'enabled' },
  },
  {
    group: 'feishu', field: 'secret', kind: 'text', label: '签名密钥',
    hint: '留空不修改；重置可清除已存密钥', secret: true,
    hiddenUnless: { group: 'feishu', field: 'enabled' },
  },
  {
    group: 'feishu', field: 'timeoutMs', kind: 'number', label: '请求超时（毫秒）',
    hiddenUnless: { group: 'feishu', field: 'enabled' },
  },
  {
    group: 'feishu', field: 'verbosity', kind: 'select', label: '内容繁复度',
    options: ['minimal', 'normal', 'detailed'],
    hiddenUnless: { group: 'feishu', field: 'enabled' },
  },
  // 消息内容
  { group: 'message', field: 'titlePrefix', kind: 'text', label: '标题前缀', hint: '如 [DSH]' },
  { group: 'message', field: 'includeSessionTitle', kind: 'toggle', label: '正文包含会话标题' },
  { group: 'message', field: 'guiUrl', kind: 'text', label: '打开链接地址' },
]
