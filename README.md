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
| 触发时机 | 需要交互（审批 `approval/asked`、提问/计划待审 `ask_user_question`、客户端 pendingInteraction）、任务完成（`agent/status` running→idle 且仅根会话 + `turn/end` 原因）、任务出错（`agent/error`） |
| 推送路径 | 系统通知（node-notifier toast）、浏览器通知（Notification API）、飞书（interactive 卡片 + HMAC-SHA256 签名）、企业微信（markdown + 可选加签）、Discord（embed 卡片）、钉钉（actionCard + 可选加签）、Telegram（Bot API HTML 消息）；`NotifyChannel` 接口可扩展 |
| 可配置 | 触发开关、各通道启停/verbosity/icon、去重冷却、标题前缀等，见[配置](#配置) |

触发语义与 Web UI 状态圆点完全对齐：**橙点 = 需要交互**（`pendingInteraction`），**绿点 = 任务完成**
（`running→idle` 且非当前会话），**蓝点 = 运行中**（不通知）。

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
>   带 `--patch` 启动同一插件**（host 端会加载两份，settings 命名空间重复注册报错）。
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

> 配置与 `settings.yaml` 同源（同一命名空间）：任一处变更均实时生效。

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
host 端把 Loader config 注册为 settings 命名空间 `messager` 的 base 层，因此：
- base 的写法按使用方式不同：dev 调试写在 `cordis.yml`（patch 覆盖层）里该行的
  `config:`；正式安装写在 **profile 的 `cordis.patch.yml`** 里按 `id: messager`
  覆盖该行，或直接改 bundle 包内的 `cordis.patch.yml`；
- 用户层三处入口，**同源不冲突、任一处变更均实时生效**（host 端 `watch` 重建通道；
  client 端经 `settings/document-updated` 失效重拉）：
  1. **设置页分区**：设置 →「通知&信使」分区（完整字段表单，所有环境可用）；
  2. **设置文档**：直接编辑 `$DSH_HOME/settings.yaml` 的 `messager:` 段（完整字段，
     含 dedup 节流等表单未展示的项）；
  3. **RPC**：settings.describe / settings.mutate（host 侧可用；Web 端白名单不影响本插件
     的分区，因为分区走插件自己的配置路由）。

> 配置读写链路：设置分区 → `GET/POST /dsh-messager/config`（webServer 路由，同源校验）
> → host 端 `settings` 服务（describe 脱敏视图 / mutate 逐字段 ops）→ settings.yaml。
> 写后 `settings/document-updated` 事件（DSH 内置转发）驱动前端刷新。
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
| 审批 | `session/event` `approval/asked` | 摘要 `pendingInteraction==='approval'` 出现 |
| 提问/计划待审 | `session/event` `tool/call`（`ask_user_question`） | `pendingInteraction==='question'/'plan-review'` 出现 |
| 任务完成 | `agent/status` running→idle（仅根会话）＋`turn/end` 原因 | 摘要 `running:true→false` 且非当前会话 |
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
├── src/
│   ├── index.ts          # host apply：事件接线 + settings 注册 + 通道构建 + 路由挂载
│   ├── config.ts         # Config schema（Loader config 与 settings 共用）
│   ├── config-shared.ts  # 配置路由的跨端共享类型（host/client 共用）
│   ├── config-route.ts   # webServer 配置路由（GET 视图 / POST ops，同源校验）
│   ├── signals.ts        # 事件 → Signal 提取（纯函数）
│   ├── notify.ts         # 调度：过滤/冷却/防抖/限流 + NotifyChannel 接口
│   ├── templates.ts      # verbosity 模板渲染（纯函数）
│   ├── settings.ts       # settings 命名空间注册（base = Loader config）
│   ├── channels/         # system（node-notifier）、feishu/wecom/discord/dingtalk/telegram（webhook/Bot API+签名）
│   └── client/           # 浏览器端：sessions diff、Notification、设置分区、配置同步
│       ├── index.ts      # 分区注册（动态 order）+ 浏览器通知 + 配置路由访问器
│       ├── section.tsx   # 设置页「通知&信使」分区组件
│       ├── settings-form.tsx  # 共享表单体（分组 + FieldRow + 操作栏）
│       ├── card-controller.ts # 表单控制器（纯逻辑，可单测）
│       ├── fetch-scope.ts     # ScopeLike 的 fetch 适配层（配置路由）
│       ├── locales.ts    # zh/en 字典（ctx.locale 注册）
│       ├── config.ts     # 浏览器通知的配置句柄（走配置路由）
│       └── diff.ts       # 会话摘要 diff（纯函数）
└── tests/                # vitest 单元测试（126 个）
```

## 测试

```sh
pnpm test       # 126 个单元测试：信号提取/模板/调度/各通道签名与载荷/配置解析/client diff/配置路由/fetch scope/字典一致性/表单门控
pnpm typecheck  # host 端
pnpm build      # host tsc + client 声明 + client bundle（lib/）
```

## 版本兼容（DSH 0.1.1-rc.2+ / APIProxy → @Remote）

- 本插件自 **v0.2.1** 起将全部 @deepseek-ai/dsh-* peerDependencies 从 `0.1.0-rc.6` 升级到
  **`0.1.1-rc.2`**（npm 当前最新），对应 DSH「旧版调用接口 APIProxy 已迁移并移除，统一使用
  @Remote 网关」的版本线；
- 兼容性要点：
  - 插件**无需源码改造**：客户端事件订阅本就走 `ctx.remote.$on`（@Remote/Typert），
    配置读写走插件自有 webServer 路由 `/dsh-messager/config`，均不依赖旧 APIProxy 面；
  - `peerDependencies` 补齐了 `dsh-api-remotes@0.1.1-rc.2` 所需的全部类型面 peer
    （api-gateway / credentials / llm / commands / typert-registry 等），保证 client 端
    Typert 类型声明合并完整（`settings/document-updated` 等转发事件可类型化订阅）；
  - 新版 DSH 的 Web 设置面有命名空间白名单（`WEB_SETTINGS_NAMESPACES`）：要让 DSH
    原生设置面读取 `messager` 命名空间，需在 DSH 源码该白名单中加入 `messager`
    （插件自身设置路由不受此限制）。

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
