# AGENTS.md

面向 AI 代码助手（如 Claude Code / DeepSeek Harness Agent）的本仓库工作指南。

## 这是什么

`dsh-messager` 是 DeepSeek Harness（DSH）的**任务状态通知插件**：会话需要交互
（审批 / 提问 / 计划待审）、任务完成、任务出错时，通过系统通知（OS toast）、
浏览器通知（Web Notification）、飞书 / 企业微信 / Discord / 钉钉 / Telegram 推送提醒。

**单包双运行端（dual-runtime）结构**：
- **host 端**（Node 服务端，`src/`）负责系统通知与全部第三方通道；
- **client 端**（浏览器，`src/client/`）负责 Web Notification 与设置页「通知&信使」分区；
- 两者配置同源：settings 命名空间 `messager`，配置通道经插件自身 webServer 路由
  `/dsh-messager/config`，**不受 DSH 设置白名单限制，发行版（npx 安装）同样可用**。

## 技术栈与构建

- 语言：TypeScript（`strict` 全开，`noUncheckedIndexedAccess` 开启，ESM，
  `NodeNext` 模块解析）；client 端含 TSX（React 18）。
- 包管理：pnpm（`packageManager: pnpm@11.7.0`）。
- 平台版本线：peerDependencies 全部为 **`@deepseek-ai/dsh-*@0.1.1-rc.2`**（DSH「APIProxy
  已移除、统一 @Remote 网关」之后的 npm 最新版；0.1.2-alpha.1 仅在 GitHub 源码，未发 npm）。
  client 端事件订阅必须走 `ctx.remote.$on`（Typert/@Remote），不要使用旧 APIProxy 面。
- 测试：vitest（`environment: 'node'`，测试位于 `tests/**/*.spec.ts`）。
- 构建：`pnpm build` = host tsc（`tsconfig.json`）+ client 声明
  （`tsconfig.client.json`，仅产出 `lib/types/`，`emitDeclarationOnly`）+ client bundle
  （`tsdown.config.ts` → `lib/client.js`，走 `window.__ModuleLoader__.load` 契约）。

关键脚本：`build`、`build:client`、`typecheck`、`test`、`test:watch`、
`prepare`（构建）、`prepublishOnly`（测试）。

## 构建与测试命令

```sh
pnpm install
pnpm typecheck   # host 端类型检查（tsc --noEmit）
pnpm test        # vitest 运行 tests/**/*.spec.ts
pnpm run build:client  # 仅 client bundle
pnpm build       # 完整构建（host tsc + client 声明 + client bundle）
```

> 改完代码请至少跑 `pnpm typecheck` 和 `pnpm test`；凡是改动 client 端代码，
> 要让浏览器生效还需重新 `pnpm run build:client`（bundle 带 rev hash 会重新拉取）。

## 双端结构速览

| 定位 | 目录 / 文件 | 职责 |
| --- | --- | --- |
| host 入口 | `src/index.ts` | `apply(ctx, config)`：事件接线（session/event、agent/status、agent/error）、settings 注册、通道构建、配置路由挂载 |
| 配置模型 | `src/config.ts` | `Config` schema（schemastery），同时充当 Loader config 与 settings 命名空间 schema；`resolveConfig` 用默认值解析 |
| 信号层 | `src/signals.ts` | 把 DSH 事件翻译为统一 `Signal`（纯函数，易单测） |
| 调度层 | `src/notify.ts` | 过滤（triggers）、冷却、完成防抖、通道限流；`NotifyChannel` 接口；`NotificationDispatcher` |
| 模板层 | `src/templates.ts` | verbosity 渲染出 `NotificationPayload`（纯函数） |
| settings 注册 | `src/settings.ts` | 命名空间 `messager` 注册（base = Loader config） |
| 配置路由 | `src/config-route.ts` | webServer 路由 `GET/POST /dsh-messager/config`，同源校验 + 脱敏视图 + 逐字段 ops |
| 共享类型 | `src/config-shared.ts` | host/client 跨端共用、不得引入 Node/浏览器专属模块 |
| 通道 | `src/channels/system.ts` | 系统通知（node-notifier，平台分流 + 图标存在性校验 + 去图标重试） |
| 通道 | `src/channels/feishu.ts` | 飞书 webhook（interactive 卡片 + HMAC-SHA256 签名，sign 在请求体内） |
| 通道 | `src/channels/wecom.ts` | 企业微信 webhook（markdown + 可选加签，HMAC 无需 URL 编码） |
| 通道 | `src/channels/discord.ts` | Discord webhook（embed 卡片，2xx 即成功、不解析 body） |
| 通道 | `src/channels/dingtalk.ts` | 钉钉 webhook（actionCard + 可选加签，HMAC 需 URL 编码） |
| 通道 | `src/channels/telegram.ts` | Telegram Bot API（sendMessage HTML，token 走 URL 路径） |
| client 入口 | `src/client/index.ts` | 分区注册（动态 order）+ 浏览器通知 + 配置路由访问器 |
| client 分区 | `src/client/section.tsx` / `settings-form.tsx` | 设置页「通知&信使」分区 UI（手写 Switch 开关组件，无 primitives 依赖） |
| client 逻辑 | `src/client/card-controller.ts`、`fetch-scope.ts`、`diff.ts`、`config.ts`、`locales.ts` | 表单控制器（含 hiddenUnless 门控）/ fetch 适配 / 会话 diff / 浏览器配置句柄 / zh-en 字典 |

## 本地开发

- **host 端（快速）**：从 DSH 仓库根目录运行
  `pnpm dsh web --patch <本仓库>/cordis.yml`，直接加载 TS 源码，HMR 生效。
  `cordis.yml` 内插件行的 `name` 路径在 Windows 上是硬编码的，换机器需改成本机路径。
- **完整双运行端**：client 端要求插件以包身份进入 Loader 才会被 clientModules 扫描编入
  Web bundle，因此完整开发要：
  ```sh
  dsh plugin --profile web add <本仓库路径>   # 源码模式 DSH：pnpm dsh plugin ...
  pnpm dsh web                                    # 从 DSH 源码仓库运行
  ```
  `plugin add` 后需**重启** DSH（clientModules 启动时扫描）。改动 client 代码后在自己的仓库
  重跑 `pnpm run build:client` 并刷新页面即可。

配置优先级：**schema 默认值 → base（Loader config）→ 用户层（Web 设置页）**。
base 的写法：dev 调试在 `cordis.yml`，正式安装走 profile 的 `cordis.patch.yml` 或 bundle 包内
`cordis.patch.yml`。配置与 `settings.yaml` 同源，任一处变更均实时生效。

## 触发语义（与 Web UI 状态圆点对齐）

- **橙点 = 需要交互**（`pendingInteraction`）：审批（`approval/asked`）、
  提问 / 计划待审（`tool/call` 且工具名为 `ask_user_question`）、client 侧摘要
  `pendingInteraction==='approval' | 'question' | 'plan-review'`。
- **绿点 = 任务完成**：`agent/status` `running→idle` 且仅根会话 + `turn/end` 原因。
- **蓝点 = 运行中**（不通知）。
- **任务出错**：`agent/error`，host 端覆盖。

> ⚠️ 子代理判别必须用 `origin === 'subagent'`，**不能用 `parentSession`** ——
> 分叉会话（sessions.fork）的 header 也携带 parentSession（指向源会话），但 origin 为空，
> 仍是顶层会话，任务完成后应正常通知。

## 常见开发约定 / 注意事项

- **双端文件 import 边界**：`src/config-shared.ts` 不得 import 任何 Node/浏览器专属模块；
  host 端（`src/` 非 client）不要混入 DOM；client 端不要 import Node 模块。
- **升级 peerDeps 时必须补齐类型面**：`dsh-api-remotes` 的 peerDependencies 会驱动 client 端
  Typert 类型声明合并（`TypertRemoteEventSelection` → `ctx.remote.$on` 的合法键集）；升版本时
  若缺失其 peer（api-gateway/credentials/llm/commands/typert-registry 等），`$on` 会退化为
  `never` 报错，需同步在 package.json 与 pnpm-workspace.yaml 补全。
- **verbatimModuleSyntax** 已开启：type-only import 要写 `import type`；否则类型检查报错。
- **`noUncheckedIndexedAccess`** 已开启：索引访问可能得到 `undefined`，需显式处理。
- **settings 服务可能晚于本插件挂载**：注册命名空间必须在 `ctx.inject(['settings'], …)`
  回调内（见 `src/index.ts`），不能直接 `ctx.get('settings')`。
- **配置路由仅 Web 环境挂载**：headless profile 无 webServer 服务时该 inject 不执行，
  不影响通知功能。
- **设置表单 = Switch + 门控**：所有 toggle 字段渲染为手写 `Switch`（settings-form.tsx）；
  每个开关类字段（各通道 `enabled`、`system.enabled`、`browser.enabled` 等）作为门控，
  其子配置需在 `CARD_FIELDS` 里加 `hiddenUnless: { group, field: 'enabled' }` —— 关闭时
  子字段不渲染、草稿不参与保存计划。新增带子配置的开关时务必同步加门控。
- **新增第三方通道的触点清单**（缺一不可）：
  1. `src/config.ts`：接口 + `Config` + schema（默认关闭；secret 字段加 `role('secret')`）；
  2. `src/channels/<id>.ts`：`createXxxChannel` + 导出纯函数（载荷构建/签名）供单测；
  3. `src/index.ts`：`buildChannels()` 分支（`enabled && 必需字段已配` 才创建）；
  4. `src/notify.ts`：`verbosityFor` 查找表加该通道；
  5. `src/client/card-controller.ts`：`CARD_FIELDS` 加字段（enabled 门控子字段）；
  6. `src/client/locales.ts`：zh/en 键（组标题/字段/hint，键集必须一致）；
  7. `src/client/settings-form.tsx`：`GROUP_TITLE_KEYS` 加组；
  8. `tests/<id>.spec.ts`：载荷/签名/成功判定（errcode/2xx/ok 差异）+ 更新 config.spec 默认值断言。
- **测试**：信号提取 / 模板 / 调度 / 各通道载荷与签名（飞书/企微/Discord/钉钉/Telegram）/
  配置解析 / client diff / 配置路由 / fetch scope / 字典一致性 / 表单控制器各有一份 spec。
  新增逻辑尽量做成纯函数以保持可测性；签名类算法硬编码已知答案向量（node crypto 预计算）；
  `locales.ts` 的 zh/en 键集必须一致（缺失键 fail loud 显示键名）。

## 发布与产物

- `package.json` 的 `files` 只含 `lib`、`assets`、`cordis.patch.yml`、`README.md`。
- 用 `pnpm publish` 前会跑 `prepublishOnly`（测试）；`prepare` 会在 install 时构建。
- npm 源：`registry.npmjs.org`。
