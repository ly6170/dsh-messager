# dsh-messager

[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-blue.svg)](package.json)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](#contributing)

> **Task-status notification plugin for DeepSeek Harness (DSH).** Get notified via **system notifications** (OS toast), **browser notifications**, and **Feishu (Lark) bot** (webhook) whenever a session needs your attention, a task completes, or a task errors — no more staring at the status dots in the session list.

<details>
<summary>中文 readme</summary>
<p>
Chinese version: <a href="README.md">README.md</a>
</p>
</details>

## Introduction

`dsh-messager` is a notification plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH). It uses a **single-package, dual-runtime** (dual-runtime) design:

- **host side** (Node, server) — handles system notifications and the Feishu webhook;
- **client side** (browser) — handles Web Notification.

Both sides share the same configuration source (settings namespace `messager`), editable live from the Web settings page.

## Feature Highlights

| Need | Implementation |
| --- | --- |
| Trigger moments | Needs interaction (approval `approval/asked`, question/plan-review `ask_user_question`, client `pendingInteraction`), task completed (`agent/status` running→idle, root session only + `turn/end` reason), task errored (`agent/error`) |
| Delivery channels | System notification (node-notifier toast), browser notification (Notification API), Feishu bot (webhook: interactive card + HMAC-SHA256 signature); `NotifyChannel` interface is extensible |
| Configurable | Trigger toggles, per-channel enable/verbosity/icon, dedup cooldown, title prefix, etc. — see [Configuration](#configuration) |

Trigger semantics align exactly with the Web UI status dots: **orange dot = needs interaction** (`pendingInteraction`), **green dot = task completed** (`running→idle`, non-current session), **blue dot = running** (not notified).

## Features

- 🟢 Three triggers — needs interaction / task completed / task errored, each independently toggleable;
- 🔔 Three channels — system, browser, Feishu bot, each independently toggleable with verbosity levels (`minimal / normal / detailed`);
- ⚙️ Hot-reloadable config — changes apply instantly, no DSH restart required;
- 🔌 Extensible channels — implement the `NotifyChannel` interface to add DingTalk / WeCom / Telegram, etc.;
- 🧪 Unit tests cover signal extraction / template rendering / scheduling dedup / Feishu signing / config parsing / client diff.

## Getting Started

### Prerequisites

| Dependency | Requirement |
| --- | --- |
| Node.js | `>= 20` |
| pnpm | `>= 10` (recommended) |
| DSH | `dsh` CLI available |

### Install from source (recommended for developers)

```sh
git clone https://github.com/ly6170/dsh-messager.git
cd dsh-messager

pnpm install
pnpm build

dsh plugin --profile web add ./
dsh web    # or dsh --profile web
```

> A full step-by-step installation guide is in [doc/用户安装指南.md](doc/用户安装指南.md) (Chinese), covering both the **source** method and the **pnpm** method (local checkout / tarball / git / npm).

### Install directly from git (requires build approval)

```sh
dsh plugin --profile web add github:ly6170/dsh-messager
```

> pnpm ≥ 10 refuses to run the `prepare` build scripts of git dependencies by default. On the first `add` you'll be prompted to add the exact package key to the `allowBuilds` in that profile's `pnpm-workspace.yaml`, then re-run `add`.

### Verify

Open `http://127.0.0.1:3080`; a "dsh-messager" card appears under Settings → Plugins once installed. The first load requests browser notification permission.

## Configuration

Configuration precedence: **schema defaults → base (that row's `config:`) → user layer (Web settings page)**.

Three user-layer entry points share the same source; any change applies instantly:

1. **Web settings page**: Settings → Plugins tab → "dsh-messager notifications" card;
2. **Settings document**: edit the `messager:` section of `$DSH_HOME/settings.yaml`;
3. **RPC**: `settings.describe` / `settings.mutate`.

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `triggers.interaction` | boolean | `true` | Notify on needs-interaction (approval/question/plan-review) |
| `triggers.completed` | boolean | `true` | Notify on task completed |
| `triggers.error` | boolean | `true` | Notify on task error |
| `system.enabled` | boolean | `true` | System notification channel |
| `system.icon` | string | - | Absolute icon path (node-notifier needs a file path; the file must exist) |
| `system.verbosity` | `minimal\|normal\|detailed` | `normal` | System notification verbosity |
| `browser.enabled` | boolean | `true` | Browser notification channel |
| `browser.icon` | string | - | Icon URL or data URL |
| `browser.onlyWhenHidden` | boolean | `true` | Notify only when page is hidden/unfocused |
| `browser.verbosity` | `minimal\|normal\|detailed` | `normal` | Browser notification verbosity |
| `feishu.enabled` | boolean | `false` | Feishu bot (webhook) channel |
| `feishu.webhookUrl` | string | - | Custom bot webhook URL |
| `feishu.secret` | string (secret) | - | Signing secret (bot "Security Settings - Signature Verification") |
| `feishu.timeoutMs` | number | `5000` | Per-request timeout |
| `feishu.verbosity` | `minimal\|normal\|detailed` | `normal` | Card verbosity |
| `dedup.interactionCooldownMs` | number | `10000` | Cooldown for same session/trigger (also the cross-tab dedup window) |
| `dedup.completedDebounceMs` | number | `1000` | Completion notification debounce |
| `dedup.perChannelPerMinute` | number | `20` | Per-channel per-minute cap |
| `message.titlePrefix` | string | - | Title prefix, e.g. `[DSH]` |
| `message.includeSessionTitle` | boolean | `true` | Include the session title in the body |
| `message.guiUrl` | string | `http://127.0.0.1:3080` | "Open" link target of the notification |

Verbosity: `minimal` shows only the title; `normal` adds session title / tool name / end reason / error summary; `detailed` additionally adds turn/step, approval reason and the GUI link.

## Channel Extension

Implement the `NotifyChannel` interface and register it in `buildChannels()` in `src/index.ts` to hook in a new third-party channel:

```ts
export interface NotifyChannel {
  readonly id: string
  send(payload: NotificationPayload): Promise<void>
}
```

## Project Structure

```
dsh-messager/
├── package.json          # dsh.bundle + dsh.client declarations; exports["./client"]
├── tsconfig.json         # host side (Node)
├── tsconfig.client.json  # client declaration output (lib/types/client)
├── tsdown.config.ts      # client bundle (__ModuleLoader__.load contract)
├── cordis.patch.yml      # distribution config layer (effective after install)
├── assets/icon.png       # default notification icon
├── doc/
│   └── 用户安装指南.md     # user installation guide
├── src/
│   ├── index.ts          # host apply: event wiring + settings registration + channel building
│   ├── config.ts         # Config schema (shared by Loader config and settings)
│   ├── signals.ts        # event → signal extraction (pure functions)
│   ├── notify.ts         # scheduling: filtering/cooldown/debounce/rate-limit + NotifyChannel interface
│   ├── templates.ts      # verbosity template rendering (pure functions)
│   ├── settings.ts       # settings namespace registration (base = Loader config)
│   ├── channels/         # system (node-notifier), feishu (webhook+signature)
│   └── client/           # browser side: sessions diff, Notification, config sync
└── tests/                # vitest unit tests
```

## Development & Testing

```sh
pnpm install
pnpm test       # unit tests: signal extraction/templates/scheduling/feishu signing/config parsing/client diff
pnpm typecheck  # host-side type checking
pnpm build      # host tsc + client declarations + client bundle (lib/)
```

## Known Limitations

- Browser notifications require site permission; with `onlyWhenHidden=false` they also pop when the page is visible;
- Multi-tab dedup relies on localStorage cooldown; different browsers notify separately;
- Child agents finishing do not trigger a completion notification (root session only), to avoid noise;
- Channel failures (webhook timeout, unavailable toast) are only logged and do not affect other channels or plugin operation;
- Completion/interaction dedup state is in-memory and resets after a DSH restart.

### System notifications (node-notifier) cross-platform caveats

`node-notifier` calls completely different native binaries per platform:

| Platform | Backend | Prerequisites / differences |
| --- | --- | --- |
| Windows | PowerShell ToastNotification | Built in, no extra install; `sound` maps reliably only on Windows |
| macOS | terminal-notifier | Requires an online download of the third-party binary on first use, and a logged-in GUI session (Dock present); `sound` has no effect |
| Linux | notify-send (libnotify) | Requires `libnotify-bin` and a running notification daemon (GNOME Shell / Plasma / mako / dunst, etc.); `sound` has no effect |

- **Icon**: `system.icon` must be an existing file path; the channel layer checks existence and degrades to no icon if invalid.

## License

[MIT](LICENSE) © [ly6170](https://github.com/ly6170)

## Contributing

Issues and Pull Requests are welcome. Adding a new third-party channel (DingTalk / WeCom / Telegram…) just requires implementing the `NotifyChannel` interface.
