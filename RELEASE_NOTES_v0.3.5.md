# dsh-messager v0.3.5

## 中文

适配 DeepSeek Harness（DSH）`0.2.0-rc.1`。请先升级 DSH，再升级本插件。

v0.3.4 使用的 `^0.1.7-rc.1` peer 范围不包含 DSH `0.2.0-rc.1`；DSH 的 bundle 兼容性检查因此会跳过整个插件。v0.3.5 将 47 项 `@deepseek-ai/dsh-*` peer 依赖及对应开发依赖更新为 `^0.2.0-rc.1`，覆盖兼容的 0.2.x 版本。其他配套依赖及插件逻辑未改动，无需迁移或重置通知配置。

验证：`pnpm install`、`pnpm peers check`、`pnpm typecheck`、`pnpm test`（147/147）、`pnpm build`、`pnpm pack --dry-run` 均通过；DSH `0.2.0-rc.1` 的兼容性检查和 profile 加载检查通过。实际重启 DSH 后的设置页与配置路由验收尚未进行。

## English

Adds support for DeepSeek Harness (DSH) `0.2.0-rc.1`. Upgrade DSH before upgrading this plugin.

The `^0.1.7-rc.1` peer range in v0.3.4 excludes DSH `0.2.0-rc.1`, causing DSH to skip the entire plugin bundle during compatibility checks. v0.3.5 updates all 47 `@deepseek-ai/dsh-*` peer ranges and matching development dependencies to `^0.2.0-rc.1`, covering compatible 0.2.x releases. Companion dependencies and plugin logic are unchanged; notification settings need no migration or reset.

Verified: `pnpm install`, `pnpm peers check`, `pnpm typecheck`, `pnpm test` (147/147), `pnpm build`, and `pnpm pack --dry-run` passed. Compatibility and profile loading checks passed against DSH `0.2.0-rc.1`. The settings page and config route have not yet been checked after a DSH restart.
