/**
 * dsh-messager 配置模型。
 *
 * 本 schema 同时承担两个角色：
 * - host 端的 Loader config（cordis.yml 中该插件行的 `config:`，成为 settings 命名空间的 base 层）；
 * - `ctx.settings.register('messager', Config, { base })` 的命名空间 schema，
 *   因此 Web 设置页会自动渲染配置表单，用户层可覆盖 base。
 *
 * 有效值优先级：schema 默认值 → base（cordis.yml）→ 用户层（设置页）。
 */

import Schema from '@deepseek-ai/schemastery'

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
  dedup: DedupConfig
  message: MessageConfig
}

const verbosity = Schema.union(['minimal', 'normal', 'detailed'] as const)

export const Config: Schema<Config> = Schema.object({
  triggers: Schema.object({
    interaction: Schema.boolean().default(true),
    completed: Schema.boolean().default(true),
    error: Schema.boolean().default(true),
  }),
  system: Schema.object({
    enabled: Schema.boolean().default(true),
    // 无 default 的字段即可选（undefined 允许）
    // 注意：node-notifier 需要文件路径且该文件必须存在；Linux（notify-send）与
    // macOS（terminal-notifier）对缺失路径可能直接失败而非像 Windows 那样降级，
    // 通道层虽已做存在性校验，仍建议配置有效的绝对路径。
    icon: Schema.string(),
    verbosity: verbosity.default('normal'),
  }),
  browser: Schema.object({
    enabled: Schema.boolean().default(true),
    icon: Schema.string(),
    onlyWhenHidden: Schema.boolean().default(true),
    verbosity: verbosity.default('normal'),
  }),
  feishu: Schema.object({
    enabled: Schema.boolean().default(false),
    webhookUrl: Schema.string(),
    secret: Schema.string().role('secret'),
    timeoutMs: Schema.number().default(5000),
    verbosity: verbosity.default('normal'),
  }),
  dedup: Schema.object({
    interactionCooldownMs: Schema.number().default(10000),
    completedDebounceMs: Schema.number().default(1000),
    perChannelPerMinute: Schema.number().default(20),
  }),
  message: Schema.object({
    titlePrefix: Schema.string(),
    includeSessionTitle: Schema.boolean().default(true),
    guiUrl: Schema.string().default('http://127.0.0.1:3080'),
  }),
})

/**
 * 用 schema 默认值解析一份配置（输入可省略任意字段）。
 * 与 cordis Loader 的校验同源，保证“默认值 → base → 用户层”的解析一致。
 */
export function resolveConfig(input: Partial<Config> = {}): Config {
  return Config(input as Config)
}
