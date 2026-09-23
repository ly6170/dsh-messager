# dsh-messager

DeepSeek Harness（DSH）**任务状态通知插件**：会话需要交互、任务完成、任务出错时，通过
**系统通知**（OS toast）、**浏览器通知**、**飞书 / 企业微信 / Discord / 钉钉 / Telegram** 推送提醒，
不再依赖盯着会话列表的圆点。

单包双运行端（dual-runtime）结构：**host 端**（Node，服务端）负责系统通知与全部第三方通道，
**client 端**（浏览器）负责 Web Notification；两者配置同源（settings 命名空间 `messager`），
设置页「通知&信使」分区可编辑、实时生效 —— 配置通道经插件自身的 webServer 路由
（`/dsh-messager/config`），**不受 DSH 设置白名单限制，发行版（npx 安装）同样可用**。

## 能力一览

| 需求 | 实现 |
| --- | --- |
| 触发时机 | 需要交互（审批 `approval/asked`、提问/计划待审 `ask_user_question`、客户端 `uiSession.sessionStatus`）、任务完成（`agent/status` running→idle 且仅根会话 + `turn/end` 原因）、任务出错（`agent/error`） |
| 推送路径 | 系统通知（node-notifier toast）、浏览器通知（Notification API）、飞书（interactive 卡片 + HMAC-SHA256 签名）、企业微信（markdown + 可选加签）、Discord（embed 卡片）、钉钉（actionCard + 可选加签）、Telegram（Bot API HTML 消息）；`NotifyChannel` 接口可扩展 |
| 可配置 | 触发开关、各通道启停/verbosity/icon、去重冷却、标题前缀等，见[配置](#配置) |

触发语义与 Web UI 状态圆点完全对齐：**橙点 = 需要交互**（`uiSession.sessionStatus`），**绿点 = 任务完成**
（`running→idle` 且不在主视图），**蓝点 = 运行中**（不通知）。

## 安装

> 📖 面向**使用方**的完整分步指南见 [doc/用户安装指南.md](doc/用户安装指南.md) —— 覆盖
> **源码方式**（clone + 本地构建）与 **pnpm 方式**（本地 checkout / tarball / git / npm）两类安装。

**正式安装只需一步**（host 端 + 浏览器 client 端都会生效，之后直接 `dsh web` 启动即可，
**不需要** `--patch`）：

```sh
# 在插件仓库构建产物
pnpm install
pnpm build

dsh plugin --profile web add <插件路径>
dsh web   # 或 dsh --profile web
```

> `pnpm install` 与 `pnpm build` 在你的插件仓库目录内执行；`<插件路径>` 替换为该目录
> （绝对或相对路径均可）。完整的分步安装指南见 [doc/用户安装指南.md](doc/用户安装指南.md)。

> - `--patch` 不是安装步骤，而是可选的**开发调试**手段（见下节「本地开发」）：
>   它只加载 host 端、不写 profile、仅对本次启动生效。装了 bundle 之后**请勿再同时
>   带 `--patch` 启动同一插件**（host 端会加载两份，同一事件重复通知）。
>   ⚠️ 另外，经 `--patch` 装入的条目 id 会带 `include:` 前缀、且**不会进入
>   `settings.describe()`**，因此 `--patch` 模式下设置页分区必然显示「不可用」——
>   这是该调试路径的固有限制，验证设置页请走 `dsh plugin add` 安装。
> - 以**源码方式运行 DSH**（从 deepseek-harness 仓库根目录）时，把上述 `dsh` 换成
>   `pnpm dsh` 即可，命令与行为完全一致：`pnpm dsh plugin --profile web add …`、
>   `pnpm dsh web`。profile 目录仍为 `$DSH_HOME/profiles/web`（`dsh web` 即
>   `--profile web` 别名）。
> - 从 git 安装时 pnpm ≥ 10 需要放行构建脚本：把 pnpm 提示的包名加入 profile 的
>   `pnpm-workspace.yaml` 的 `allowBuilds`（见 DSH 官方 publish 教程）。

### 设置分区「通知&信使」（所有环境可用）

安装后 DSH 设置页左侧菜单会出现 **「通知&信使」** 分区（排在「Agent预设」下方，位置
随已有分区动态计算，不写死）。分区内是完整的配置表单，读写经插件自身的
webServer 路由（`/dsh-messager/config`，同源校验 + 脱敏视图）直达 host 端
`settings` 服务 —— **不依赖 DSH 的设置白名单，发行版（npx 安装）开箱即用**，
无需任何补丁。

> 配置与 host 端**同源**（同一 settings 命名空间）：任一处变更均实时生效。

## 本地开发

- **host 端（快速）**：从 DSH 仓库根目录运行
  `pnpm dsh web --patch <插件路径>/cordis.yml`，直接加载 TS 源码（HMR 生效）。
  源码模式下的 host 经 tsx 运行，该路径无需构建即可加载。
- **完整双运行端**：浏览器（client）端要求插件以包身份进入 Loader 才会被 clientModules
  扫描编入 Web bundle（`--patch` 的文件路径入口不会被扫描），因此完整开发请安装到 profile：
  ```sh
  dsh plugin --profile web add <插件路径>   # 源码模式：pnpm dsh plugin ...
  pnpm dsh web   # 从 DSH 源码仓库运行
  ```
  `plugin add` 后需要**重启** `pnpm dsh web`（clientModules 启动时扫描，运行中的实例
  不会热加入新 bundle）。修改 client 端代码后在自己的仓库重新 `pnpm run build:client`
  并刷新页面即可（bundle 带 rev hash 会重新拉取；DSH 仓库的 `dev:web` watcher 只盯
  workspace 内的 client 插件，不盯外部插件）。

浏览器通知需要用户授予权限：首次加载插件时若权限为 `default` 会自动请求一次；
被拒绝时浏览器通道静默降级（其余通道不受影响），可在浏览器站点设置中重新授权。

## 配置

配置优先级：**schema 默认值 → base（该插件行的 `config:`）→ 用户层（Web 设置页）**。

> ⚠️ **DSH 0.1.7 的配置模型**（与旧版不同，务必知悉）：
> - settings 命名空间 = 插件在 profile 中的**条目 id**（本包 `cordis.patch.yml`
>   声明为 `messager`），**不是**插件自己注册的字符串；
> - schema 由 Loader 直接读取**插件入口模块导出的 `Config`**，因此 `src/index.ts`
>   必须 `export { Config }`——不导出则该条目被 `describe()` 静默跳过，设置页与
>   配置路由一律显示「不可用」且**不报错**；
> - 所有可编辑字段必须标记 `.volatile()`：DSH 用 volatile 门控写入，非 volatile
>   路径会被 `settings.mutate` 拒绝，且无 volatile 字段时整个命名空间判为不可配置；
> - 已**没有** `ctx.settings.register(...)` 这种 API；配置热更新改由
>   `settings/document-updated` 事件驱动。

- base 的写法按使用方式不同：dev 调试写在 `cordis.yml`（patch 覆盖层）里该行的
  `config:`；正式安装写在 **profile 的 `cordis.patch.yml`** 里按 `id: messager`
  覆盖该行，或直接改 bundle 包内的 `cordis.patch.yml`；
- 用户层两处入口，**同源不冲突、任一处变更均实时生效**（host 端订阅
  `settings/document-updated` 重建通道；client 端同样据此失效重拉）：
  1. **设置页分区**：设置 →「通知&信使」分区（完整字段表单，所有环境可用）；
  2. **RPC**：settings.describe / settings.mutate（host 侧可用；Web 端白名单不影响
     本插件的分区，因为分区走插件自己的配置路由）。

> 配置读写链路：设置分区 → `GET/POST /dsh-messager/config`（webServer 路由，同源校验）
> → host 端 `settings` 服务（describe 脱敏视图 / mutate 逐字段 ops）→ profile 的
> `cordis.patch.yml`。写后 `settings/document-updated` 事件（DSH 内置转发）驱动前端刷新。
>
> 📌 DSH 0.1.7 已废弃 `$DSH_HOME/settings.yaml` 作为配置源：启动时若存在会被自动
> 导入 profile 并**重命名为 `settings.yaml.imported`**。请改编辑 profile 的
> `cordis.patch.yml`（或用设置页）。
>
> 🌐 **国际化**：分区菜单与表单文案随 DSH 设置的语言切换（中文 / English），
> 字典注册在 `ctx.locale`（zh/en 键集一致，缺失键 fail loud 显示键名）。

| 字段 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `triggers.interaction` | boolean | `true` | 需要交互时通知（审批/提问/计划待审） |
| `triggers.completed` | boolean | `true` | 任务完成时通知 |
| `triggers.error` | boolean | `true` | 任务出错时通知 |
| `system.enabled` | boolean | `true` | 系统通知通道 |
| `system.icon` | string | - | 图标绝对路径（node-notifier 需要文件路径，**且该文件必须存在**） |
| `system.verbosity` | `minimal\|normal\|detailed` | `normal` | 系统通知内容繁复度 |
| `browser.enabled` | boolean | `true` | 浏览器通知通道 |
| `browser.icon` | string | - | 图标 URL 或 data URL |
| `browser.onlyWhenHidden` | boolean | `true` | 仅页面隐藏/未聚焦时弹（看着界面不打扰） |
| `browser.verbosity` | `minimal\|normal\|detailed` | `normal` | 浏览器通知内容繁复度 |
| `feishu.enabled` | boolean | `false` | 飞书机器人（webhook）通道 |
| `feishu.webhookUrl` | string | - | 自定义机器人 webhook 地址 |
| `feishu.secret` | string（secret） | - | 签名密钥（机器人「安全设置-签名校验」） |
| `feishu.timeoutMs` | number | `5000` | 单次请求超时 |
| `feishu.verbosity` | `minimal\|normal\|detailed` | `normal` | 卡片内容繁复度 |
| `wecom.enabled` | boolean | `false` | 企业微信群机器人（webhook）通道 |
| `wecom.webhookUrl` | string | - | 群机器人 webhook 地址（含 `?key=`） |
| `wecom.secret` | string（secret） | - | 加签密钥（「安全设置-加签」，HMAC-SHA256，无需 URL 编码） |
| `wecom.timeoutMs` | number | `5000` | 单次请求超时 |
| `wecom.verbosity` | `minimal\|normal\|detailed` | `normal` | 消息内容繁复度 |
| `discord.enabled` | boolean | `false` | Discord 通道（webhook） |
| `discord.webhookUrl` | string | - | Discord webhook 地址（`.../api/webhooks/<id>/<token>`） |
| `discord.timeoutMs` | number | `5000` | 单次请求超时 |
| `discord.verbosity` | `minimal\|normal\|detailed` | `normal` | embed 内容繁复度 |
| `dingtalk.enabled` | boolean | `false` | 钉钉自定义机器人（webhook）通道 |
| `dingtalk.webhookUrl` | string | - | 自定义机器人 webhook 地址（含 `?access_token=`） |
| `dingtalk.secret` | string（secret） | - | 加签密钥（「安全设置-加签」，HMAC-SHA256 + URL 编码） |
| `dingtalk.timeoutMs` | number | `5000` | 单次请求超时 |
| `dingtalk.verbosity` | `minimal\|normal\|detailed` | `normal` | 卡片内容繁复度 |
| `telegram.enabled` | boolean | `false` | Telegram 通道（Bot API） |
| `telegram.botToken` | string（secret） | - | Bot Token（@BotFather 获取） |
| `telegram.chatId` | string | - | 接收 chat_id（数字 ID 或 `@频道用户名`） |
| `telegram.timeoutMs` | number | `5000` | 单次请求超时 |
| `telegram.verbosity` | `minimal\|normal\|detailed` | `normal` | 消息内容繁复度 |
| `dedup.interactionCooldownMs` | number | `10000` | 同会话同触发冷却（也用于跨标签去重窗口） |
| `dedup.completedDebounceMs` | number | `1000` | 完成通知防抖（等待 turn/end 原因、合并边界） |
| `dedup.perChannelPerMinute` | number | `20` | 每通道每分钟上限（防第三方限流/刷屏） |
| `message.titlePrefix` | string | - | 标题前缀，如 `[DSH]` |
| `message.includeSessionTitle` | boolean | `true` | 正文附带会话标题 |
| `message.guiUrl` | string | `http://127.0.0.1:3080` | 通知「打开」链接/按钮目标 |

内容繁复度：`minimal` 只有标题；`normal` 增加会话标题/工具名/结束原因/错误摘要；
`detailed` 再增加 turn/step、审批原因与 GUI 链接。

## 触发信号（事件 → 通知映射）

| 触发 | host 端（system/feishu/wecom/discord/dingtalk/telegram） | client 端（browser） |
| --- | --- | --- |
| 审批 | `session/event` `approval/asked` | `ctx.uiSession.sessionStatus` 中 `pendingInteraction.kind==='approval'` 从无到有 |
| 提问/计划待审 | `session/event` `tool/call`（`ask_user_question`） | `ctx.uiSession.sessionStatus` 中 `pendingInteraction.kind==='question'/'plan-review'` 从无到有 |
| 任务完成 | `agent/status` running→idle（仅根会话）＋`turn/end` 原因 | 摘要 `running:true→false` 且 `retainedBy.mainView` 为空 |
| 任务出错 | `agent/error` | -（host 端覆盖） |

## 通道扩展

新增第三方通道（钉钉/企业微信/Telegram…）实现 `NotifyChannel` 接口并在
`src/index.ts` 的 `buildChannels()` 注册即可：

```ts
export interface NotifyChannel {
  readonly id: string
  send(payload: NotificationPayload): Promise<void>
}
```

## 项目结构

```
dsh-messager/
├── package.json          # dsh.bundle + dsh.client 双声明；exports["./client"]
├── tsconfig.json         # host 端（Node）
├── tsconfig.client.json  # client 端声明输出（lib/types/client）
├── tsdown.config.ts      # client bundle（__ModuleLoader__.load 契约）
├── cordis.yml            # 本地开发覆盖层（host 端）
├── cordis.patch.yml      # 分发包配置层（安装后生效）
├── assets/icon.png       # 默认通知图标
├── doc/plan/             # 规划存档（01 起编号）
├── src/
│   ├── index.ts          # host apply：事件接线 + 通道构建 + 路由挂载（并导出 Config schema）
│   ├── config.ts         # Config schema（全字段 .volatile()；Loader config 与 settings 共用）
│   ├── config-shared.ts  # 配置路由的跨端共享类型（host/client 共用）
│   ├── config-route.ts   # webServer 配置路由（GET 视图 / POST ops，同源校验）
│   ├── signals.ts        # 事件 → Signal 提取（纯函数）
│   ├── notify.ts         # 调度：过滤/冷却/防抖/限流 + NotifyChannel 接口
│   ├── templates.ts      # verbosity 模板渲染（纯函数）
│   ├── settings.ts       # 条目 id（settings 命名空间）解析，供配置路由使用
│   ├── channels/         # system（node-notifier）、feishu/wecom/discord/dingtalk/telegram（webhook/Bot API+签名）
│   └── client/           # 浏览器端：sessions diff、Notification、设置分区、配置同步
│       ├── index.ts      # 分区注册（动态 order）+ 浏览器通知 + 配置路由访问器
│       ├── section.tsx   # 设置页「通知&信使」分区组件
│       ├── settings-form.tsx  # 共享表单体（分组 + FieldRow + 操作栏）
│       ├── card-controller.ts # 表单控制器（纯逻辑，可单测）
│       ├── fetch-scope.ts     # ScopeLike 的 fetch 适配层（配置路由）
│       ├── locales.ts    # zh/en 字典（ctx.locale 注册）
│       ├── config.ts     # 浏览器通知的配置句柄（走配置路由）
│       └── diff.ts       # 完成摘要 / 待交互状态 diff（纯函数）
└── tests/                # vitest 单元测试（147 个）
```

## 测试

```sh
pnpm test       # 147 个单元测试：信号提取/模板/调度/各通道签名与载荷/配置解析与 volatile 契约/client diff/配置路由/fetch scope/字典一致性/表单门控
pnpm typecheck  # host 端
pnpm build      # host tsc + client 声明 + client bundle（lib/）
```

> ⚠️ 测试**不会**投递真实系统通知：`vitest.config.ts` 用 `resolve.alias` 把
> `node-notifier` 换成 no-op 桩（`tests/stubs/node-notifier.ts`）。系统通道的 schema
> 默认值就是 `enabled: true`，不换桩的话 `pnpm test` 会真的弹 Windows toast。

## 版本兼容（dsh-messager 0.3.3 / DSH 0.1.7-alpha.1）

- **v0.3.3 仅支持 DSH `0.1.7-alpha.1`**；所有 `@deepseek-ai/dsh-*` peerDependencies
  统一锁定该版本，不再兼容旧 RC 接口。
- client 端适配新版拆分：会话列表来自 `dsh-api-session-controller`，交互状态来自
  `dsh-client-ui-session` 的 `ctx.uiSession.sessionStatus`，`ctx.slots` 由
  `dsh-client-ui-renderer` 提供；不再依赖已移除的 `dsh-client-runtime`。
- 完成通知仍按会话摘要 `running: true → false` 且不在主视图触发；交互通知仅在
  `approval` / `question` / `plan-review` 从无到有时触发，首次订阅只建立基线。
- host 设置使用 profile 条目 id 作为命名空间（本包为 `messager`）；配置读写继续走插件
  自有 webServer 路由 `/dsh-messager/config`，现有 schema 与第三方通道配置无需迁移或重置。
- **0.1.7 配置模型迁移**（v0.3.2）：移除已不存在的 `ctx.settings.register`；schema 改由
  Loader 读取入口导出的 `Config`；全部可编辑字段标记 `.volatile()`；命名空间由
  `ctx.fiber.entry.options.id` 动态解析（不再硬编码）。`@deepseek-ai/cordis` 升至
  `^4.0.3`（4.0.2 不导出 `Volatile`），`schemastery` 对齐 `^3.18.3`（避免双实例）。
- **v0.3.3**：host 调度器改为**投递时读取 volatile 引用**（不再缓存配置快照，也不再依赖
  `settings/document-updated` 的时序），配置一改立即生效；client 端修掉「拉取失败静默开启
  浏览器通知」与「浏览器通道忽略 `triggers.*`」两个缺陷，并在标签页恢复可见时补拉配置。

## 已知边界

- 浏览器通知需站点权限；`onlyWhenHidden=false` 时页面可见也会弹。
- 多标签页经 localStorage 冷却去重；不同浏览器各自通知。
- 子代理结束不触发完成通知（仅根会话），避免噪音。
- 通道失败（webhook 超时、toast 不可用）只记日志，不影响其他通道与插件运行。
- 完成/交互的去重状态为内存态，DSH 重启后重置（可接受）。

### 系统通知（node-notifier）跨平台前提

`node-notifier` 在三个平台调用**完全不同的底层程序**，平台差异如下：

| 平台 | 底层 | 前提条件 / 差异 |
| --- | --- | --- |
| Windows | PowerShell ToastNotification | 内建，无需额外安装；`sound` 仅在 Windows 有可靠映射 |
| macOS | terminal-notifier | 首次使用需**联网下载**第三方二进制，且需登录图形会话（Dock 存在）；`sound` 不生效 |
| Linux | notify-send（libnotify） | 需安装 `libnotify-bin`，并有一个**运行中的通知守护进程**（GNOME Shell / Plasma / mako / dunst 等）；`sound` 不生效 |

- **图标**：`system.icon` 需是**存在的文件路径**。Windows 对缺失路径多会静默降级，但
  Linux/macOS 可能直接报错，故通道层已做存在性校验，无效时降级为不带图标。
- **环境差异不是插件 bug**：Linux 若缺通知守护进程、macOS 若无法联网下载
  terminal-notifier 或不在图形会话中，通知可能不弹出或静默失败——此时请先排查上述前提，
  而非插件；失败时调度层会 `logWarn` 记录具体错误。

## 后续规划

- 第三方通道扩展：邮件
- 触发扩展：后台 job 完成、goal 轮次完成
- 通知历史、按会话静音、勿扰时段

规划存档见 `doc/plan/01-通知插件实施规划.md`。
