# dsh-messager

[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![npm version](https://img.shields.io/npm/v/dsh-messager)](https://www.npmjs.com/package/dsh-messager)
[![Node](https://img.shields.io/badge/node-%3E%3D20-blue.svg)](package.json)

> **Task-status notification plugin for DeepSeek Harness (DSH).** Get notified via **system notifications** (OS toast), **browser notifications**, and a **Feishu (Lark) bot** (webhook) whenever a session needs attention, a task completes, or a task errors.

A single-package, dual-runtime design: the **host side** (Node) handles system notifications and the Feishu webhook; the **client side** (browser) handles Web Notification. Both share one config source (namespace `messager`), editable live from the "Notifications" settings section — config flows through the plugin's own webserver route (`/dsh-messager/config`), so it works on all environments including release/npx/npm installs (no DSH settings allowlist dependency).

## Features

- 🟢 Three triggers — needs-interaction / completed / errored, each toggleable
- 🔔 Three channels — system (node-notifier), browser (Notification API), Feishu bot (webhook + HMAC-SHA256 signature)
- ⚙️ Hot-reloadable config — applies instantly, no restart
- 🌐 Internationalized settings section (简体中文 / English) via `ctx.locale`
- ⌨️ Browser shortcut `Ctrl+Shift+M` opens the settings panel (no apiproxy allowlist needed)
- 🔌 Extensible channels via the `NotifyChannel` interface

Trigger semantics align with the Web UI status dots: orange = needs interaction, green = completed (non-current session), blue = running (not notified).

## Installation

Install from npm (recommended, prebuilt `lib/` — no build approval needed):

```sh
dsh plugin --profile web add dsh-messager
dsh web
```

If you don't have the `dsh` CLI preinstalled, run it on the fly via npx:

```sh
npx -p @deepseek-ai/dsh dsh plugin --profile web add dsh-messager
npx -p @deepseek-ai/dsh dsh web
```

From source (for development / customizing):

```sh
git clone https://github.com/ly6170/dsh-messager.git
cd dsh-messager
pnpm install
pnpm build
npx -p @deepseek-ai/dsh dsh plugin --profile web add ./
npx -p @deepseek-ai/dsh dsh web
```

## Configuration

Precedence: **schema defaults → base (that row's `config:`) → user layer (settings section/document/RPC)**. Any change applies instantly.

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `triggers.interaction` | boolean | `true` | Notify on needs-interaction |
| `triggers.completed` | boolean | `true` | Notify on task completed |
| `triggers.error` | boolean | `true` | Notify on task error |
| `system.enabled` | boolean | `true` | System notification channel |
| `system.icon` | string | - | Absolute icon path (must exist) |
| `system.verbosity` | `minimal\|normal\|detailed` | `normal` | System content verbosity |
| `browser.enabled` | boolean | `true` | Browser notification channel |
| `browser.onlyWhenHidden` | boolean | `true` | Notify only when page hidden/unfocused |
| `browser.verbosity` | `minimal\|normal\|detailed` | `normal` | Browser content verbosity |
| `feishu.enabled` | boolean | `false` | Feishu bot (webhook) channel |
| `feishu.webhookUrl` | string | - | Custom bot webhook URL |
| `feishu.secret` | string (secret) | - | Signing secret |
| `feishu.timeoutMs` | number | `5000` | Per-request timeout |
| `feishu.verbosity` | `minimal\|normal\|detailed` | `normal` | Card content verbosity |
| `dedup.interactionCooldownMs` | number | `10000` | Cooldown for same session/trigger |
| `dedup.completedDebounceMs` | number | `1000` | Completion debounce |
| `dedup.perChannelPerMinute` | number | `20` | Per-channel per-minute cap |
| `message.titlePrefix` | string | - | Title prefix |
| `message.includeSessionTitle` | boolean | `true` | Include session title |
| `message.guiUrl` | string | `http://127.0.0.1:3080` | "Open" link target |

## Known limitations

- Browser notifications require site permission; with `onlyWhenHidden=false` they also pop when visible.
- Multi-tab dedup uses localStorage cooldown; each browser notifies separately.
- Subagent completions are not notified (root sessions only) — forked sessions count as top-level and do notify.
- Channel failures are only logged; they don't affect other channels or the plugin.
- Completion/interaction dedup state is in-memory and resets after a DSH restart.

## License

[MIT](LICENSE) © [ly6170](https://github.com/ly6170)
