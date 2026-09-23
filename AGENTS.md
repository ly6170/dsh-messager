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
- 平台版本线：插件版本 **`0.3.3`**，仅支持 DSH **`0.1.7-alpha.1`**；所有
  `@deepseek-ai/dsh-*` peerDependencies 统一锁定该版本，不兼容旧 RC 接口。
  client 端会话列表使用 `dsh-api-session-controller`，交互状态使用
  `dsh-client-ui-session`，槽位服务使用 `dsh-client-ui-renderer`；不要重新引入已移除的
  `dsh-client-runtime`。
- 测试：vitest（`environment: 'node'`，测试位于 `tests/**/*.spec.ts`）。
  ⚠️ `vitest.config.ts` 用 `resolve.alias` 把 `node-notifier` 全局换成 no-op 桩
  （`tests/stubs/node-notifier.ts`）：系统通道的 schema 默认值就是 `enabled: true`，
  不换桩的话 `pnpm test` 会**真的往开发机弹系统通知**（Windows 上是 SnoreToast）。
  已发生过：这些噪音被误判成「插件运行时故障」，浪费了大量排查时间。
  新增涉及投递的测试时，务必确认这条 alias 仍在。
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
| host 入口 | `src/index.ts` | `apply(ctx, config)`：事件接线（session/event、agent/status、agent/error）、通道构建、配置路由挂载；**必须 `export { Config }`**（见下） |
| 配置模型 | `src/config.ts` | `Config` schema（schemastery，全字段 `.volatile()`），同时充当 Loader config 与 settings 表单 schema；`resolveConfig` 解 volatile 包装并套默认值 |
| 信号层 | `src/signals.ts` | 把 DSH 事件翻译为统一 `Signal`（纯函数，易单测） |
| 调度层 | `src/notify.ts` | 过滤（triggers）、冷却、完成防抖、通道限流；`NotifyChannel` 接口；`NotificationDispatcher` |
| 模板层 | `src/templates.ts` | verbosity 渲染出 `NotificationPayload`（纯函数） |
| 配置层 | `src/settings.ts` | 解析 profile 条目 id（= settings 命名空间），供配置路由使用 |
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
  `pnpm dsh --patch <本仓库>/cordis.yml --profile web`，直接加载 TS 源码，HMR 生效。
  `cordis.yml` 内插件行的 `name` 路径在 Windows 上是硬编码的，换机器需改成本机路径。
  ⚠️ 该模式**只适合调事件/通道逻辑**：`--patch` 装入的条目 id 带 `include:` 前缀且
  **不进入 `settings.describe()`**，所以设置页分区必然显示「不可用」、配置路由返回
  `unavailable` —— 这是该路径的固有限制，不是 bug。要验证设置页/配置读写，必须走下面的
  `dsh plugin add`（bundle 方式）。
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
`cordis.patch.yml`，任一处变更均实时生效。

> 📌 DSH 0.1.7 起 `$DSH_HOME/settings.yaml` **不再是配置源**：启动时若存在会被自动导入
> profile 并重命名为 `settings.yaml.imported`。配置实体是 profile 的 `cordis.patch.yml`。

## ⚠️ DSH 0.1.7 配置模型（三个必踩的坑）

0.1.7 的 settings 架构与 0.1.2 时代**完全反转**：不再是插件把 schema「推」给 settings，
而是 Loader 从插件模块「拉」schema。以下三点缺一即静默失效（**不报错**，只是设置页
与配置路由显示「不可用」）：

1. **入口必须导出 `Config` schema。** Loader 读的是 `entry.fiber.runtime.Config`
   （见 `packages/settings/settings/src/index.ts` 的 `schema(entry)`）。schema 只在
   `src/config.ts` 定义、`src/index.ts` 不 `export { Config }` 的话，该条目会被
   `describe()` 直接跳过。→ `src/index.ts` 有 `export { Config } from './config.js'`。
2. **所有可编辑叶子字段必须 `.volatile()`。** DSH 用 `isVolatilePath` 门控写入：
   非 volatile 路径被 `settings.mutate` 拒绝（"Config field ... is not volatile"），
   且无任何 volatile 字段时 `volatileForm` 返回 undefined → 整个命名空间不可配置。
   代价：schema 输出形态变为 `Volatile<T>`（`RuntimeConfig`），纯值经
   `resolveConfig()` 解包后再给内部逻辑用（`Volatile` 从 `@deepseek-ai/cordis` 导出，
   需 cordis ≥ 4.0.3；4.0.2 不导出它）。
3. **命名空间 = profile 条目 id，且必须用 `entry.options.id`。**
   `Entry.id` 是带父级前缀的**复合** id（profile 行都挂在根 include 下，形如
   `include:messager`），而 settings 的 `ns` 用的是原始行 id。用 `Entry.id` 会永远
   匹配不上。→ `src/settings.ts` 的 `resolveNamespace()` 沿 fiber 父链上溯取
   `options.id`；**不要**改用 `Loader.locate()`（它返回复合 id）。

另外：**没有** `ctx.settings.register(ns, schema, {base})` 这种 API（0.1.2 时代写法，
0.1.7 已移除，调用即 `undefined is not a function` 导致插件加载失败）。热更新改订阅
`settings/document-updated` 事件。

> 🔬 验证配置层是否真的通了（`--patch` 调试模式下必然不通，见下）：
> 用 `dsh plugin add` 装进 profile 后启动，然后
> `curl -H 'accept: application/json' http://127.0.0.1:<port>/dsh-messager/config`，
> 应返回 `{"status":"ready",...}` 与完整配置值。

## 触发语义（与 Web UI 状态圆点对齐）

- **橙点 = 需要交互**：host 端来自 `approval/asked` 或 `ask_user_question`；client 端订阅
  `ctx.uiSession.sessionStatus` 中的 `pendingInteraction`，仅在 `approval | question | plan-review` 从无到有时通知，
  首次快照只建立基线，未知 kind 忽略。
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
- **client 服务已拆分**：`ctx.sessions` 的类型合并来自
  `dsh-api-session-controller/client`，`ctx.uiSession.sessionStatus` 来自
  `dsh-client-ui-session/client`，`ctx.slots` 来自 `dsh-client-ui-renderer/client`；
  `dsh-client-ui-slots` 只提供槽位核心类型，不应放入 `dsh.client.inject`。
- **verbatimModuleSyntax** 已开启：type-only import 要写 `import type`；否则类型检查报错。
- **`noUncheckedIndexedAccess`** 已开启：索引访问可能得到 `undefined`，需显式处理。
- **settings 服务可能晚于本插件挂载**：读取配置必须在 `ctx.inject(['settings'], …)`
  回调内（见 `src/index.ts`），不能直接 `ctx.get('settings')`。
- **配置路由仅 Web 环境挂载**：headless profile 无 webServer 服务时该 inject 不执行，
  不影响通知功能。
- **设置表单 = Switch + 门控**：所有 toggle 字段渲染为手写 `Switch`（settings-form.tsx）；
  每个开关类字段（各通道 `enabled`、`system.enabled`、`browser.enabled` 等）作为门控，
  其子配置需在 `CARD_FIELDS` 里加 `hiddenUnless: { group, field: 'enabled' }` —— 关闭时
  子字段不渲染、草稿不参与保存计划。新增带子配置的开关时务必同步加门控。
- **新增第三方通道的触点清单**（缺一不可）：
  1. `src/config.ts`：接口 + `Config` + schema（默认关闭；secret 字段加 `role('secret')`；
     **每个叶子字段都要 `.volatile()`**，否则设置页写不进，见上「配置模型」）；
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

## 升级归档

- **2026-09-23 · v0.3.3**：修掉三处**真实**缺陷 + 一处**测试卫生**问题。
  1. **host 端改为「投递时求值」**（`src/notify.ts` + `src/index.ts`）：调度器不再缓存
     配置快照，改为注入 `readConfig()` / `buildChannels(config)`，每次投递都从 Loader
     交给 `apply()` 的 **volatile 引用**取实时值（`Entry._commitVolatile` 会就地更新它们）。
     这是 DSH 官方插件（pwsh-local 等）的惯例用法，也让「设置页一改就生效」不再依赖
     `settings/document-updated` 的事件时序。顺带**删除了配置用的 settings inject** ——
     插件自身配置不需要 settings 服务，它只用于浏览器配置路由。
     `src/settings.ts` 相应精简为只做命名空间解析。
  2. **client 拉取失败不再静默开启通知**（`src/client/config.ts`）：原来初始值取 schema
     默认值，而 `browser.enabled` 默认是 `true` → 任何一次拉取失败都会在用户已关闭通知
     的情况下开启推送。现改为 FAIL_SAFE（显式关闭），成功拉到 host 值后才采用。
  3. **浏览器通道补上 `triggers.*` 门控**（`src/client/diff.ts` 的 `triggerAllows`）：
     此前该通道完全没有这层判断，「关闭某类触发」对浏览器通知无效。
     另在标签页恢复可见时补拉一次配置（后台标签可能错过转发事件，导致配置长期陈旧）。
  4. **测试不再弹真实系统通知**：`vitest.config.ts` 用 `resolve.alias` 把 `node-notifier`
     换成 no-op 桩（`tests/stubs/node-notifier.ts`）。此前 `pnpm test` 会真的往开发机弹
     Windows toast（SnoreToast），这些噪音被误判成「插件运行时故障」，浪费了大量排查时间。
     新增自检用例断言桩确实拦到了投递。
  5. **设置表单保存可见性**（`src/client/settings-form.tsx`）：表单有约 40 个字段，
     底部操作栏会随内容滚出视野，用户切完开关以为已生效（实际只是草稿，需点「保存」）。
     现将底部操作栏改为**粘性**（`position: sticky; bottom: 0`，背景取面板同色
     `--dsw-alias-bg-layer-2` 以免透视），并在顶部增加「有未保存的修改 (N)」提示条
     （内含保存按钮）。控制器新增 `dirtyCount`（= 保存计划的 ops 条数）；
     注意 `dirty` 必须包含**非法草稿**，否则「放弃修改」会被禁用、用户无法丢弃错误输入。
- 测试 134 → 147（新增 volatile 就地更新、通道按当前配置重建、client FAIL_SAFE、
  triggers 门控、通知桩自检、dirtyCount 语义）。
- 本次验证：`pnpm typecheck`、`pnpm test`（147/147）、`pnpm build` 通过。
- **2026-09-10 · v0.3.2 补齐 DSH `0.1.7-alpha.1` 适配（host 端）**：上一轮只迁了 client 端，
  host 端仍在调用 0.1.7 已移除的 `ctx.settings.register(...)`，导致插件加载即失败
  （`undefined is not a function`）。本轮修复：
  1. 删除 `settings.register`，改为「Loader 拉 schema」模型 —— 入口
     `export { Config }`，命名空间由 `resolveNamespace()` 沿 fiber 父链取
     `entry.options.id`，热更新订阅 `settings/document-updated`；
  2. `Config` 全部叶子字段标记 `.volatile()`（否则设置页不可写）；新增
     `RuntimeConfig = VolatileShape<Config>` 与 `resolveConfig()` 解包；
  3. 依赖对齐：`@deepseek-ai/cordis` `^4.0.2` → `^4.0.3`（4.0.2 不导出 `Volatile`）、
     `schemastery` → `^3.18.3`（消除与 DSH 的双实例）、补 `@deepseek-ai/cosmokit`；
  4. 补齐 DSH 类型面为 devDependencies（optional peer 不会被 `pnpm install` 安装，
     缺了会让 `ctx.on` 事件名退化为 `never`，typecheck 报 25 个错）；
  5. 修 `pnpm-workspace.yaml` 的 `minimumReleaseAgeExclude`：原来逐条 `name@version`
     列举，漏一条即 `pnpm install` 直接失败，改为官方支持的 scope 通配 `@deepseek-ai/*`。
- 本次验证：`pnpm typecheck`、`pnpm test`（134/134）、`pnpm build` 通过；并在真实
  DSH `0.1.7-alpha.1` 上以 `dsh plugin add`（bundle 方式）装载验收 —— host 与 client
  均加载成功，配置路由 `GET` 返回 `status: ready` 且值完整，`POST` 写入返回
  `{ok:true}` 并 revision 递增，client bundle 已编入 Web 模块表。
- **2026-09-02 · v0.3.0**：迁移至 DSH `0.1.2-alpha.5`，移除 `dsh-client-runtime`，
  接入 `dsh-api-session-controller`、`dsh-client-ui-session` 与 `dsh-client-ui-renderer`；
  settings 命名空间统一为字符串 `messager`，交互通知改由
  `ctx.uiSession.pendingInteractions` 的无→有变化驱动。
- 手动加载最新版 DSH 验收通过：Host 与 client 均成功加载，设置页「通知&信使」、配置
  GET/POST 路由、审批/提问/计划待审及后台任务完成通知均符合预期，系统与第三方通道测试保持通过。
- 本次升级验证：`pnpm peers check`、`pnpm typecheck`、`pnpm test`（129/129）、
  `pnpm build`、`pnpm pack --dry-run` 全部通过；未迁移或重置现有配置。

## 发布与产物

- `package.json` 的 `files` 只含 `lib`、`assets`、`cordis.patch.yml`、`README.md`。
- 用 `pnpm publish` 前会跑 `prepublishOnly`（测试）；`prepare` 会在 install 时构建。
- npm 源：`registry.npmjs.org`。
## Codex 会话命名

新建或继续任务时，将会话标题统一为 `MMDD | {本次会话应使用的版本变化或 tag} | {会话核心描述}`。没有版本变化时使用项目当前版本号；项目没有版本号时才使用 `无版本变化`。标题应简洁、使用中文、不要添加句末标点。用户明确指定标题时，以用户指定为准。
