# dsh-messager

[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-blue.svg)](package.json)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](#贡献)

> **DeepSeek Harness（DSH）任务状态通知插件。** 当会话需要交互、任务完成或任务出错时，通过**系统通知**（OS toast）、**浏览器通知**与**飞书机器人（webhook）**推送提醒——不再依赖盯着会话列表的圆点。

<details>
<summary>English readme</summary>
<p>
English version: <a href="README.en.md">README.en.md</a>
</p>
</details>

## 简介

`dsh-messager` 是 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）的一个通知插件，属于**单包双运行端（dual-runtime）**结构：

- **host 端**（Node，服务端）——负责系统通知与飞书 webhook；
- **client 端**（浏览器）——负责 Web Notification。

两端配置同源（settings 命名空间 `messager`），Web 设置页可编辑、即时生效。

## 能力一览

| 需求 | 实现 |
| --- | --- |
| 触发时机 | 需要交互（审批 `approval/asked`、提问/计划待审 `ask_user_question`、客户端 `pendingInteraction`）、任务完成（`agent/status` running→idle 且仅根会话 + `turn/end` 原因）、任务出错（`agent/error`） |
| 推送路径 | 系统通知（node-notifier toast）、浏览器通知（Notification API）、飞书机器人（webhook：interactive 卡片 + HMAC-SHA256 签名）；`NotifyChannel` 接口可扩展 |
| 可配置 | 触发开关、各通道启停/verbosity/icon、去重冷却、标题前缀等，见[配置](#配置) |

触发语义与 Web UI 状态圆点完全对齐：**橙点 = 需要交互**（`pendingInteraction`），**绿点 = 任务完成**（`running→idle` 且非当前会话），**蓝点 = 运行中**（不通知）。

## 特性

- 🟢 三种触发：需要交互 / 任务完成 / 任务出错，可独立开关；
- 🔔 三条通道：系统通知、浏览器通知、飞书机器人，可独立启停、久内容繁复度（`minimal / normal / detailed`）；
- ⚙️ 热更新配置：改设置即生效，无需重启 DSH；
- 🔌 可扩展通道：实现 `NotifyChannel` 接口即可接入钉钉 / 企业微信 / Telegram 等；
- 🧪 单元测试覆盖信号提取 / 模板渲染 / 调度去重 / 飞书签名 / 配置解析 / client diff。

## 快速开始

### 前置条件

| 依赖 | 要求 |
| --- | --- |
| Node.js | `>= 20` |
| pnpm | `>= 10`（推荐） |
| DSH | `dsh` CLI 可用 |

### 从源码安装（推荐给开发者）

```sh
git clone https://github.com/<你的用户名>/dsh-messager.git
cd dsh-messager

pnpm install
pnpm build

dsh plugin --profile web add ./
dsh web    # 或 dsh --profile web
```

> 完整的分步安装指南见 [doc/用户安装指南.md](doc/用户安装指南.md)，覆盖**源码方式**与 **pnpm 方式**（本地 checkout / tarball / git / npm）两类安装。

### 从 git 直接安装（需构建授权）

```sh
dsh plugin --profile web add github:<你的用户名>/dsh-messager
```

> pnpm ≥ 10 默认拒绝运行 git 依赖的 `prepare` 构建脚本，第一次 `add` 会提示把确切的包键加入该 profile 的 `pnpm-workspace.yaml` 的 `allowBuilds`，然后重新 `add`。

### 验证

打开 `http://127.0.0.1:3080`，设置 → Plugins 页出现「dsh-messager」卡片即安装成功。首次加载会请求浏览器通知权限。

## 配置

配置优先级：**schema 默认值 → base（该插件行的 `config:`）→ 用户层（Web 设置页）**。

用户层三处入口，同源不冲突、任一变更即时生效：

1. **Web 设置页**：设置 → Plugins 标签页 →「dsh-messager 通知」卡片；
2. **设置文档**：编辑 `$DSH_HOME/settings.yaml` 的 `messager:` 段；
3. **RPC**：`settings.describe` / `settings.mutate`。

| 字段 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `triggers.interaction` | boolean | `true` | 需要交互时通知（审批/提问/计划待审） |
| `triggers.completed` | boolean | `true` | 任务完成时通知 |
| `triggers.error` | boolean | `true` | 任务出错时通知 |
| `system.enabled` | boolean | `true` | 系统通知通道 |
| `system.icon` | string | - | 图标绝对路径（node-notifier 需要文件路径，且文件必须存在） |
| `system.verbosity` | `minimal\|normal\|detailed` | `normal` | 系统通知内容繁复度 |
| `browser.enabled` | boolean | `true` | 浏览器通知通道 |
| `browser.icon` | string | - | 图标 URL 或 data URL |
| `browser.onlyWhenHidden` | boolean | `true` | 仅页面隐藏/未聚焦时弹出 |
| `browser.verbosity` | `minimal\|normal\|detailed` | `normal` | 浏览器通知内容繁复度 |
| `feishu.enabled` | boolean | `false` | 飞书机器人（webhook）通道 |
| `feishu.webhookUrl` | string | - | 自定义机器人 webhook 地址 |
| `feishu.secret` | string（secret） | - | 签名密钥（机器人「安全设置-签名校验」） |
| `feishu.timeoutMs` | number | `5000` | 单次请求超时 |
| `feishu.verbosity` | `minimal\|normal\|detailed` | `normal` | 卡片内容繁复度 |
| `dedup.interactionCooldownMs` | number | `10000` | 同会话同触发冷却（也用于跨标签去重窗口） |
| `dedup.completedDebounceMs` | number | `1000` | 完成通知防抖 |
| `dedup.perChannelPerMinute` | number | `20` | 每通道每分钟上限 |
| `message.titlePrefix` | string | - | 标题前缀，如 `[DSH]` |
| `message.includeSessionTitle` | boolean | `true` | 正文附带会话标题 |
| `message.guiUrl` | string | `http://127.0.0.1:3080` | 通知「打开」链接目标 |

内容繁复度：`minimal` 只有标题；`normal` 增加会话标题/工具名/结束原因/错误摘要；`detailed` 再增加 turn/step、审批原因与 GUI 链接。

## 通道扩展

实现 `NotifyChannel` 接口并在 `src/index.ts` 的 `buildChannels()` 注册即可接入新第三方通道：

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
├── cordis.patch.yml      # 分发包配置层（安装后生效）
├── assets/icon.png       # 默认通知图标
├── doc/
│   └── 用户安装指南.md     # 使用方安装指南
├── src/
│   ├── index.ts          # host apply：事件接线 + settings 注册 + 通道构建
│   ├── config.ts         # Config schema（Loader config 与 settings 共用）
│   ├── signals.ts        # 事件 → Signal 提取（纯函数）
│   ├── notify.ts         # 调度：过滤/冷却/防抖/限流 + NotifyChannel 接口
│   ├── templates.ts      # verbosity 模板渲染（纯函数）
│   ├── settings.ts       # settings 命名空间注册（base = Loader config）
│   ├── channels/         # system（node-notifier）、feishu（webhook+签名）
│   └── client/           # 浏览器端：sessions diff、Notification、配置同步
└── tests/                # vitest 单元测试
```

## 开发与测试

```sh
pnpm install
pnpm test       # 单元测试：信号提取/模板/调度/飞书签名/配置解析/client diff
pnpm typecheck  # host 端类型检查
pnpm build      # host tsc + client 声明 + client bundle（lib/）
```

> 本地开发完整步骤见 [doc/用户安装指南.md](doc/用户安装指南.md) 的「本地开发调试」小节。

## 已知边界

- 浏览器通知需站点权限；`onlyWhenHidden=false` 时页面可见也会弹；
- 多标签页经 localStorage 冷却去重；不同浏览器各自通知；
- 子代理结束不触发完成通知（仅根会话），避免噪音；
- 通道失败（webhook 超时、toast 不可用）只记日志，不影响其他通道与插件运行；
- 完成/交互的去重状态为内存态，DSH 重启后重置。

### 系统通知（node-notifier）跨平台前提

`node-notifier` 在三个平台调用完全不同的底层程序：

| 平台 | 底层 | 前提条件 / 差异 |
| --- | --- | --- |
| Windows | PowerShell ToastNotification | 内建，无需额外安装；`sound` 仅在 Windows 有可靠映射 |
| macOS | terminal-notifier | 首次使用需联网下载第三方二进制，且需登录图形会话（Dock 存在）；`sound` 不生效 |
| Linux | notify-send（libnotify） | 需安装 `libnotify-bin`，并有运行中的通知守护进程（GNOME Shell / Plasma / mako / dunst 等）；`sound` 不生效 |

- **图标**：`system.icon` 需是存在的文件路径，通道层已做存在性校验，无效时降级为不带图标。

## 许可

[MIT](LICENSE) © [ly6170](https://github.com/ly6170)

## 贡献

欢迎提交 Issue 与 Pull Request。新增第三方通道（钉钉/企业微信/Telegram…）只需实现 `NotifyChannel` 接口。

## 后续规划

- 第三方通道扩展：钉钉/企业微信/Telegram/邮件
- 触发扩展：后台 job 完成、goal 轮次完成
- 通知历史、按会话静音、勿扰时段
