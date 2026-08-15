# dsh-messager

[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![npm version](https://img.shields.io/npm/v/dsh-messager)](https://www.npmjs.com/package/dsh-messager)
[![Node](https://img.shields.io/badge/node-%3E%3D20-blue.svg)](package.json)

> **DeepSeek Harness（DSH）任务状态通知插件** / *Task-status notification plugin for DeepSeek Harness (DSH)*
>
> 会话需要交互、任务完成、任务出错时，通过**系统通知**（OS toast）、**浏览器通知**、**飞书机器人（webhook）**推送提醒——不再依赖盯着会话列表的圆点。
> *Get notified via system notifications, browser notifications, and a Feishu (Lark) bot whenever a session needs attention, a task completes, or a task errors.*

单包双运行端（dual-runtime）结构：**host 端**（Node）负责系统通知与飞书 webhook，**client 端**（浏览器）负责 Web Notification。两者配置同源（命名空间 `messager`），设置页「通知&信使」分区可编辑、实时生效——配置经插件自身的 webServer 路由（`/dsh-messager/config`），**不受 DSH 设置白名单限制，发行版（npx/npm 安装）同样可用**。

---

## 目录 / Table of Contents

- [特性 / Features](#特性--features)
- [安装 / Installation](#安装--installation)
- [配置 / Configuration](#配置--configuration)
- [设置分区 / Settings section](#设置分区通知信使--settings-section)
- [触发信号 / Trigger signals](#触发信号--trigger-signals)
- [通道扩展 / Channel extension](#通道扩展--channel-extension)
- [项目结构 / Project structure](#项目结构--project-structure)
- [开发与测试 / Development](#开发与测试--development)
- [已知边界 / Known limitations](#已知边界--known-limitations)
- [许可 / License](#许可--license)

---

## 特性 / Features

| 特性 | 说明 |
| --- | --- |
| **触发时机** | 需要交互（审批 / 提问 / 计划待审）、任务完成、任务出错，见[触发信号](#触发信号--trigger-signals) |
| **推送路径** | 系统通知（node-notifier toast）、浏览器通知（Notification API）、飞书机器人（webhook：interactive 卡片 + HMAC-SHA256 签名） |
| **可配置** | 各通道启停 / 内容繁复度 / icon、触发开关、去重冷却、标题前缀等 |
| **国际化** | 设置分区菜单与表单随 DSH 语言切换（中文 / English），经 `ctx.locale` 注册 zh/en 字典 |
| **快捷入口** | 浏览器可经快捷键 `Ctrl+Shift+M` 打开设置面板（不依赖 apiproxy 白名单） |
| **易接入** | `NotifyChannel` 接口可扩展第三方通道（钉钉 / 企业微信 / Telegram 等） |

触发语义与 Web UI 状态圆点完全对齐：**橙点 = 需要交互**（`pendingInteraction`），**绿点 = 任务完成**（`running→idle` 且非当前会话），**蓝点 = 运行中**（不通知）。

---

## 安装 / Installation

> 支持 **npm / npx / git / 源码**四种安装方式。推荐的正式安装只需一步（host + client 都会生效）。

### 方式一：npm（推荐）<sup>已发布 npm</sup> / *Via npm (recommended, published)*

已发布到 npm（`dsh-messager`）。DSH 环境已装的用户直接执行：

```sh
dsh plugin --profile web add dsh-messager
dsh web     # 或 dsh --profile web
```

> 尚未预装 `dsh` CLI 时，用 npx 现拉官方发行版执行（无需先全局装 dsh）：
> ```sh
> npx -p @deepseek-ai/dsh dsh plugin --profile web add dsh-messager
> npx -p @deepseek-ai/dsh dsh web
> ```
> npm 包已含构建产物 `lib/`，安装无需构建授权。
> *The npm package ships prebuilt `lib/`, so no build-approval is needed.*

### 方式二：源码（开发 / 修改代码）/ *From source*

```sh
git clone https://github.com/ly6170/dsh-messager.git
cd dsh-messager

pnpm install
pnpm build

npx -p @deepseek-ai/dsh dsh plugin --profile web add ./
npx -p @deepseek-ai/dsh dsh web
```

> 使用方分步指南（源码 / pnpm 方式）见 [doc/用户安装指南.md](doc/用户安装指南.md)。
> *Step-by-step guide: [doc/用户安装指南.md](doc/用户安装指南.md).*

### 方式三：从 git 直接安装 / *Directly from git (needs build approval)*

```sh
npx -p @deepseek-ai/dsh dsh plugin --profile web add github:ly6170/dsh-messager
```

> ⚠️ git 安装拉取的是源码，需跑 `prepare` 构建。pnpm ≥ 10 默认拒绝 git 依赖的构建脚本，首次 `add` 会提示把确切的包键加入该 profile `pnpm-workspace.yaml` 的 `allowBuilds`，然后重新 `add`：
> ```yaml
> allowBuilds:
>   dsh-messager: true
> ```

### 验证 / Verify

打开 `http://127.0.0.1:3080`，设置 → 侧边菜单出现「通知&信使」分区即安装成功；首次加载会请求浏览器通知权限。

---

## 配置 / Configuration

配置优先级：**schema 默认值 → base（该插件行的 `config:`）→ 用户层（Web 设置页/分区）**。

用户层入口（同源不冲突、任一变更实时生效）：

1. **设置页「通知&信使」分区**：完整字段表单，所有环境（含发行版）可用；
2. **设置文档**：编辑 `$DSH_HOME/settings.yaml` 的 `messager:` 段（完整字段，含 dedup 节流等）；
3. **RPC**：`settings.describe` / `settings.mutate`（host 侧可用）。

| 字段 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `triggers.interaction` | boolean | `true` | 需要交互时通知 |
| `triggers.completed` | boolean | `true` | 任务完成时通知 |
| `triggers.error` | boolean | `true` | 任务出错时通知 |
| `system.enabled` | boolean | `true` | 系统通知通道 |
| `system.icon` | string | - | 图标绝对路径（node-notifier 需要文件路径，且该文件必须存在） |
| `system.verbosity` | `minimal\|normal\|detailed` | `normal` | 系统通知内容繁复度 |
| `browser.enabled` | boolean | `true` | 浏览器通知通道 |
| `browser.onlyWhenHidden` | boolean | `true` | 仅页面隐藏/未聚焦时弹 |
| `browser.verbosity` | `minimal\|normal\|detailed` | `normal` | 浏览器通知内容繁复度 |
| `feishu.enabled` | boolean | `false` | 飞书机器人（webhook）通道 |
| `feishu.webhookUrl` | string | - | 自定义机器人 webhook 地址 |
| `feishu.secret` | string（secret） | - | 签名密钥（机器人「安全设置-签名校验」） |
| `feishu.timeoutMs` | number | `5000` | 单次请求超时 |
| `feishu.verbosity` | `minimal\|normal\|detailed` | `normal` | 卡片内容繁复度 |
| `dedup.interactionCooldownMs` | number | `10000` | 同会话同触发冷却 |
| `dedup.completedDebounceMs` | number | `1000` | 完成通知防抖 |
| `dedup.perChannelPerMinute` | number | `20` | 每通道每分钟上限 |
| `message.titlePrefix` | string | - | 标题前缀 |
| `message.includeSessionTitle` | boolean | `true` | 正文附带会话标题 |
| `message.guiUrl` | string | `http://127.0.0.1:3080` | 通知「打开」链接目标 |

内容繁复度：`minimal` 只有标题；`normal` 增加会话标题 / 工具名 / 结束原因 / 错误摘要；`detailed` 再增加 turn/step、审批原因与 GUI 链接。

---

## 设置分区「通知&信使」/ *Settings section*

安装后 DSH 设置页左侧菜单出现 **「通知&信使」** 分区，内含完整配置表单。读写经插件自身的 webServer 路由（`/dsh-messager/config`，同源校验 + 脱敏视图）直达 host 端 `settings` 服务——**不依赖 DSH 设置白名单，发行版（npx/npm 安装）开箱即用，无需任何补丁**。

> 配置与 `settings.yaml` 同源（同一命名空间），任一处变更均实时生效。
> *Internationalized: the section menu and form follow the DSH display language (简体中文 / English).*

---

## 触发信号 / Trigger signals

| 触发 | host 端（system/feishu） | client 端（browser） |
| --- | --- | --- |
| 审批 | `session/event` `approval/asked` | 摘要 `pendingInteraction==='approval'` 出现 |
| 提问/计划待审 | `session/event` `tool/call`（`ask_user_question`） | `pendingInteraction==='question'/'plan-review'` 出现 |
| 任务完成 | `agent/status` running→idle（仅根会话）＋`turn/end` 原因 | 摘要 `running:true→false` 且非当前会话 |
| 任务出错 | `agent/error` | -（host 端覆盖） |

> **分叉会话（fork）处理**：完成通知只对真正的子代理（`origin === 'subagent'`）排除，分叉会话（`sessions.fork`，其 `parentSession` 指向源会话但 `origin` 为空）视为顶层会话，照常通知。

---

## 通道扩展 / Channel extension

实现 `NotifyChannel` 接口并在 `src/index.ts` 的 `buildChannels()` 注册即可接入新通道：

```ts
export interface NotifyChannel {
  readonly id: string
  send(payload: NotificationPayload): Promise<void>
}
```

---

## 项目结构 / Project structure

```
dsh-messager/
├── package.json          # dsh.bundle + dsh.client 双声明；exports["./client"]；publishConfig/prepublishOnly
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
│   ├── channels/         # system（node-notifier）、feishu（webhook+签名）
│   └── client/           # 浏览器端：sessions diff、Notification、设置分区、配置同步
│       ├── index.ts      # 分区注册（动态 order）+ 浏览器通知 + 配置路由访问器
│       ├── section.tsx   # 设置页「通知&信使」分区组件
│       ├── settings-form.tsx  # 共享表单体（分组 + FieldRow + 操作栏）
│       ├── card-controller.ts # 表单控制器（纯逻辑，可单测）
│       ├── fetch-scope.ts     # ScopeLike 的 fetch 适配层（配置路由）
│       ├── locales.ts    # zh/en 字典（ctx.locale 注册）
│       ├── config.ts     # 浏览器通知的配置句柄（走配置路由）
│       └── diff.ts       # 会话摘要 diff（纯函数）
└── tests/                # vitest 单元测试
```

---

## 开发与测试 / Development

```sh
pnpm install
pnpm test       # 单元测试：信号/模板/调度/飞书签名/配置解析/client diff/配置路由/fetch scope/字典一致性
pnpm typecheck  # host 端类型检查
pnpm build      # host tsc + client 声明 + client bundle（lib/）
```

---

## 已知边界 / Known limitations

- 浏览器通知需站点权限；`onlyWhenHidden=false` 时页面可见也会弹；
- 多标签页经 localStorage 冷却去重，不同浏览器各自通知；
- 子代理结束不触发完成通知（仅根会话）——分叉会话视为顶层且会通知；
- 通道失败（webhook 超时、toast 不可用）只记日志，不影响其他通道与插件运行；
- 完成/交互去重状态为内存态，DSH 重启后重置。

### 系统通知（node-notifier）跨平台前提

`node-notifier` 在三个平台调用完全不同的底层程序：

| 平台 | 底层 | 前提条件 / 差异 |
| --- | --- | --- |
| Windows | PowerShell ToastNotification | 内建，无需额外安装；`sound` 仅在 Windows 有可靠映射 |
| macOS | terminal-notifier | 首次使用需联网下载第三方二进制，且需登录图形会话（Dock 存在）；`sound` 不生效 |
| Linux | notify-send（libnotify） | 需安装 `libnotify-bin`，并有运行中的通知守护进程（GNOME Shell / Plasma / mako / dunst 等）；`sound` 不生效 |

---

## 许可 / License

[MIT](LICENSE) © [ly6170](https://github.com/ly6170)
