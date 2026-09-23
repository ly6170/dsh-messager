/**
 * dsh-messager 配置模型。
 *
 * DSH 0.1.7 起，本 schema 由 **Loader 自动接管**：插件模块导出的 `Config` 即
 * settings 表单的 schema，命名空间 = profile 中该插件条目的 id（本仓库的
 * `cordis.patch.yml` / `cordis.yml` 都声明为 `messager`）。
 * 因此**不再有** `ctx.settings.register(...)` 这一步。
 *
 * ⚠️ 所有可编辑字段必须标记 `.volatile()`：DSH 用 `isVolatilePath` 门控写入，
 * 非 volatile 路径一律被 `settings.mutate` 拒绝（"Config field ... is not volatile"），
 * 且没有任何 volatile 字段时整个命名空间会被 `volatileForm` 判为不可配置
 * （"Plugin entry ... has no volatile fields"），设置页直接报废。
 * 这是 0.1.7 的硬契约，不是可选项。
 *
 * 有效值优先级：schema 默认值 → base（Loader config）→ 用户层（设置页）。
 */

import Schema from '@deepseek-ai/schemastery'
import { isVolatile, type Volatile } from '@deepseek-ai/cosmokit'

/** 通知内容繁复度。 */
export type Verbosity = 'minimal' | 'normal' | 'detailed'

/** 触发时机开关（需求 1：什么时候通知）。 */
export interface TriggerConfig {
  /** 会话需要交互（审批 / 提问 / 计划待审）时通知。 */
  interaction: boolean
  /** 任务执行完毕时通知。 */
  completed: boolean
  /** 任务出错时通知。 */
  error: boolean
}

/** 系统通知通道（OS 级 toast，host 端由 node-notifier 投递）。 */
export interface SystemChannelConfig {
  enabled: boolean
  /** 图标：绝对路径（或包内 assets/icon.png 的绝对路径）。 */
  icon?: string
  verbosity: Verbosity
}

/** 浏览器通知通道（Web Notification API，client 端投递）。 */
export interface BrowserChannelConfig {
  enabled: boolean
  /** 图标：URL 或 data URL。 */
  icon?: string
  /** 仅当页面隐藏/未聚焦时才弹通知，避免看着界面还被打扰。 */
  onlyWhenHidden: boolean
  verbosity: Verbosity
}

/** 飞书机器人通道（webhook 版，即自定义机器人 webhook，host 端投递）。 */
export interface FeishuChannelConfig {
  enabled: boolean
  /** 飞书自定义机器人 webhook 地址。 */
  webhookUrl?: string
  /** 签名密钥（飞书机器人 webhook“安全设置-签名校验”），配置后按 HMAC-SHA256 签名。 */
  secret?: string
  /** 单次请求超时（ms）。 */
  timeoutMs: number
  verbosity: Verbosity
}

/** 企业微信群机器人通道（webhook，host 端投递）。 */
export interface WecomChannelConfig {
  enabled: boolean
  /** 群机器人 webhook 地址（形如 https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxx）。 */
  webhookUrl?: string
  /** 加签密钥（机器人「安全设置-加签」），配置后按 HMAC-SHA256 签名（无需 URL 编码）。 */
  secret?: string
  /** 单次请求超时（ms）。 */
  timeoutMs: number
  verbosity: Verbosity
}

/** Discord 通道（webhook，host 端投递）。 */
export interface DiscordChannelConfig {
  enabled: boolean
  /** Discord webhook 地址（形如 https://discord.com/api/webhooks/<id>/<token>）。 */
  webhookUrl?: string
  /** 单次请求超时（ms）。 */
  timeoutMs: number
  verbosity: Verbosity
}

/** 钉钉自定义机器人通道（webhook，host 端投递）。 */
export interface DingtalkChannelConfig {
  enabled: boolean
  /** 自定义机器人 webhook 地址（形如 https://oapi.dingtalk.com/robot/send?access_token=xxx）。 */
  webhookUrl?: string
  /** 加签密钥（机器人「安全设置-加签」），配置后按 HMAC-SHA256 签名（需 URL 编码）。 */
  secret?: string
  /** 单次请求超时（ms）。 */
  timeoutMs: number
  verbosity: Verbosity
}

/** Telegram 通道（Bot API，host 端投递）。 */
export interface TelegramChannelConfig {
  enabled: boolean
  /** Bot Token（@BotFather 获取）。 */
  botToken?: string
  /** 接收 chat_id（数字 ID 或 @频道用户名）。 */
  chatId?: string
  /** 单次请求超时（ms）。 */
  timeoutMs: number
  verbosity: Verbosity
}

/** 去重 / 节流配置。 */
export interface DedupConfig {
  /** 同一会话同一类触发的冷却时间（ms）。 */
  interactionCooldownMs: number
  /** 完成通知防抖窗口（ms）：等待 turn/end 事件以丰富内容并合并边界抖动。 */
  completedDebounceMs: number
  /** 每通道每分钟通知上限（防止第三方通道限流/刷屏）。 */
  perChannelPerMinute: number
}

/** 消息内容配置。 */
export interface MessageConfig {
  /** 标题前缀，例如 "[DSH]"。 */
  titlePrefix?: string
  /** 正文是否附带会话标题。 */
  includeSessionTitle: boolean
  /** GUI 地址，用于通知中的“打开”链接/按钮。 */
  guiUrl: string
}

export interface Config {
  triggers: TriggerConfig
  system: SystemChannelConfig
  browser: BrowserChannelConfig
  feishu: FeishuChannelConfig
  wecom: WecomChannelConfig
  discord: DiscordChannelConfig
  dingtalk: DingtalkChannelConfig
  telegram: TelegramChannelConfig
  dedup: DedupConfig
  message: MessageConfig
}

const verbosity = Schema.union(['minimal', 'normal', 'detailed'] as const)

// 全部叶子字段 .volatile() —— 见文件头说明，0.1.7 用 volatile 门控设置页写入。
//
// 这里**不写** `: Schema<Config>` 标注（DSH 官方插件同样不标注）：`.volatile()`
// 让 schema 的输出形态变成 `RuntimeConfig`，而 `Schema<T>` 的 `meta.default` 用的是
// *输入*（纯值）形态，两种标注都对不上，交给 schemastery 推导即可。
export const Config = Schema.object({
  triggers: Schema.object({
    interaction: Schema.boolean().default(true).volatile(),
    completed: Schema.boolean().default(true).volatile(),
    error: Schema.boolean().default(true).volatile(),
  }),
  system: Schema.object({
    enabled: Schema.boolean().default(true).volatile(),
    // 无 default 的字段即可选（undefined 允许）
    // 注意：node-notifier 需要文件路径且该文件必须存在；Linux（notify-send）与
    // macOS（terminal-notifier）对缺失路径可能直接失败而非像 Windows 那样降级，
    // 通道层虽已做存在性校验，仍建议配置有效的绝对路径。
    icon: Schema.string().volatile(),
    verbosity: verbosity.default('normal').volatile(),
  }),
  browser: Schema.object({
    enabled: Schema.boolean().default(true).volatile(),
    icon: Schema.string().volatile(),
    onlyWhenHidden: Schema.boolean().default(true).volatile(),
    verbosity: verbosity.default('normal').volatile(),
  }),
  feishu: Schema.object({
    enabled: Schema.boolean().default(false).volatile(),
    webhookUrl: Schema.string().volatile(),
    secret: Schema.string().role('secret').volatile(),
    timeoutMs: Schema.number().default(5000).volatile(),
    verbosity: verbosity.default('normal').volatile(),
  }),
  wecom: Schema.object({
    enabled: Schema.boolean().default(false).volatile(),
    webhookUrl: Schema.string().volatile(),
    secret: Schema.string().role('secret').volatile(),
    timeoutMs: Schema.number().default(5000).volatile(),
    verbosity: verbosity.default('normal').volatile(),
  }),
  discord: Schema.object({
    enabled: Schema.boolean().default(false).volatile(),
    webhookUrl: Schema.string().volatile(),
    timeoutMs: Schema.number().default(5000).volatile(),
    verbosity: verbosity.default('normal').volatile(),
  }),
  dingtalk: Schema.object({
    enabled: Schema.boolean().default(false).volatile(),
    webhookUrl: Schema.string().volatile(),
    secret: Schema.string().role('secret').volatile(),
    timeoutMs: Schema.number().default(5000).volatile(),
    verbosity: verbosity.default('normal').volatile(),
  }),
  telegram: Schema.object({
    enabled: Schema.boolean().default(false).volatile(),
    botToken: Schema.string().role('secret').volatile(),
    chatId: Schema.string().volatile(),
    timeoutMs: Schema.number().default(5000).volatile(),
    verbosity: verbosity.default('normal').volatile(),
  }),
  dedup: Schema.object({
    interactionCooldownMs: Schema.number().default(10000).volatile(),
    completedDebounceMs: Schema.number().default(1000).volatile(),
    perChannelPerMinute: Schema.number().default(20).volatile(),
  }),
  message: Schema.object({
    titlePrefix: Schema.string().volatile(),
    includeSessionTitle: Schema.boolean().default(true).volatile(),
    guiUrl: Schema.string().default('http://127.0.0.1:3080').volatile(),
  }),
})

/**
 * 递归把纯值形态映射为 volatile 引用形态。
 *
 * `.volatile()` 只标在**叶子**上（分组对象本身不标），因此推导结果与
 * schemastery 的实际输出一致：分组是普通对象，叶子是 `Volatile<T>` 引用。
 * 这就是 Loader 传给 `apply(ctx, config)` 的运行时配置形态。
 */
export type VolatileShape<T> = {
  [K in keyof T]: T[K] extends object ? VolatileShape<T[K]> : Volatile<T[K]>
}

/** Loader 传入 `apply()` 的运行时配置（可编辑字段是 volatile 引用）。 */
export type RuntimeConfig = VolatileShape<Config>

/**
 * 递归解开 volatile 引用，得到纯值。
 *
 * volatile 引用在配置热更新时**原地变更**（这正是无需重挂载的原因），
 * 所以引用本身要保留；本插件的内部逻辑（通道构建/调度/模板）只需要某一时刻的
 * 纯值，因此在边界处统一取值。
 */
function unwrapVolatile(value: unknown): unknown {
  if (isVolatile(value)) return unwrapVolatile(value.get())
  if (Array.isArray(value)) return value.map(unwrapVolatile)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, unwrapVolatile(child)]),
    )
  }
  return value
}

/**
 * 用 schema 默认值解析一份配置（输入可省略任意字段）。
 *
 * 输入既可以是纯值（Loader config / settings 视图），也可以是 Loader 传入的
 * volatile 形态 —— 两者都先解包再校验，保证「默认值 → base → 用户层」解析一致。
 */
export function resolveConfig(input: unknown = {}): Config {
  return unwrapVolatile(Config(unwrapVolatile(input) as never)) as Config
}
