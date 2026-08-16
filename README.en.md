# dsh-messager

[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![npm version](https://img.shields.io/npm/v/dsh-messager)](https://www.npmjs.com/package/dsh-messager)
[![Node](https://img.shields.io/badge/node-%3E%3D20-blue.svg)](package.json)

> **Task-status notification plugin for DeepSeek Harness (DSH).** Get notified via **system notifications** (OS toast), **browser notifications**, and **Feishu / WeCom / Discord / DingTalk / Telegram** whenever a session needs attention, a task completes, or a task errors — no more staring at the status dots in the session list.

A single-package, dual-runtime design: the **host side** (Node server) handles system notifications and all third-party channels; the **client side** (browser) handles Web Notification. Both share one config source (settings namespace `messager`), editable live from the "Messenger" settings section — config flows through the plugin's own webserver route (`/dsh-messager/config`), so it works on all environments including release/npx/npm installs (no DSH settings allowlist dependency).

## Feature overview

| Need | Implementation |
| --- | --- |
| Triggers | Needs-interaction (approval `approval/asked`, question/plan-review `ask_user_question`, client `pendingInteraction`), task completed (`agent/status` running→idle, root sessions only + `turn/end` reason), task errored (`agent/error`) |
| Channels | System (node-notifier toast), browser (Notification API), Feishu (interactive card + HMAC-SHA256 signature), WeCom (markdown + optional signing), Discord (embed card), DingTalk (actionCard + optional signing), Telegram (Bot API HTML message); extensible via the `NotifyChannel` interface |
| Configurable | Trigger toggles, per-channel enable/verbosity/icon, dedup cooldowns, title prefix, etc. — see [Configuration](#configuration) |

Trigger semantics align with the Web UI status dots: **orange = needs interaction** (`pendingInteraction`), **green = task completed** (`running→idle` and not the current session), **blue = running** (not notified).

## Installation

> 📖 A full step-by-step guide for **end users** is at [doc/用户安装指南.md](doc/用户安装指南.md) (Chinese) — covering **from source** (clone + local build) and **pnpm** (local checkout / tarball / git / npm) installs.

**One step for a formal install** (host + browser client both take effect; then just start with `dsh web` — **no** `--patch` needed):

```sh
# Build inside the plugin repo
pnpm install
pnpm build

dsh plugin --profile web add <plugin-path>
dsh web   # or dsh --profile web
```

> `pnpm install` and `pnpm build` run inside your plugin checkout; replace `<plugin-path>` with that directory (absolute or relative both work).

> - `--patch` is **not** an install step — it is an optional **development** tool (see "Local development" below): it loads only the host side, writes nothing to the profile, and applies to the current launch only. After installing the bundle, **do not** start the same plugin with `--patch` simultaneously (the host side loads twice and the settings namespace registration conflicts).
> - When running DSH **from source** (from the deepseek-harness repo root), replace `dsh` with `pnpm dsh` — identical behavior: `pnpm dsh plugin --profile web add …`, `pnpm dsh web`. The profile directory stays `$DSH_HOME/profiles/web` (`dsh web` is the `--profile web` alias).
> - Installing from git with pnpm ≥ 10 requires approving build scripts: add the package key pnpm prompts for to the profile's `pnpm-workspace.yaml` `allowBuilds` (see the official DSH publish tutorial).

### Settings section "Messenger" (available everywhere)

After installation, a **「通知&信使」** (Messenger) section appears in the DSH settings sidebar (below "Agent presets"; its position is computed dynamically from existing sections, not hard-coded). It hosts the full config form, read/written through the plugin's own webserver route (`/dsh-messager/config`, same-origin check + redacted view) straight to the host `settings` service — **no dependency on the DSH settings allowlist; works out of the box on release (npx) installs**, no patches needed.

> The config is the same source as `settings.yaml` (same namespace): any change applies instantly everywhere.

## Local development

- **Host side (quick)**: from the DSH repo root run
  `pnpm dsh web --patch <plugin-path>/cordis.yml` — loads the TS source directly (HMR works). In source mode the host runs via tsx, so no build is needed to load that path.
- **Full dual-runtime**: the browser (client) side requires the plugin to enter the Loader as a package for clientModules to scan it into the Web bundle (`--patch` file-path entries are not scanned), so do a full install into the profile:
  ```sh
  dsh plugin --profile web add <plugin-path>   # source mode: pnpm dsh plugin ...
  pnpm dsh web   # run from the DSH source repo
  ```
  **Restart** `pnpm dsh web` after `plugin add` (clientModules scans at startup; a running instance does not hot-add new bundles). After changing client code, re-run `pnpm run build:client` in your own repo and refresh the page (the bundle carries a rev hash so it is re-fetched; the DSH repo's `dev:web` watcher only watches in-workspace client plugins, not external ones).

Browser notifications require user permission: the plugin requests it once on load when the permission is `default`; if denied, the browser channel degrades silently (other channels are unaffected) — re-authorize in the browser's site settings.

## Configuration

Precedence: **schema defaults → base (that row's `config:`) → user layer (Web settings section)**. The host registers the Loader config as the `messager` namespace's base, therefore:

- How to write base differs by usage: for dev debugging write `config:` on the row in `cordis.yml` (patch overlay); for formal installs override the row by `id: messager` in the **profile's `cordis.patch.yml`**, or edit the `cordis.patch.yml` inside the bundle package;
- The user layer has three entry points, **same source, no conflicts, any change applies instantly** (host `watch` rebuilds channels; client refetches on `settings/document-updated`):
  1. **Settings section**: Settings → "Messenger" (full field form, available in all environments);
  2. **Settings document**: edit the `messager:` block of `$DSH_HOME/settings.yaml` directly (all fields, including dedup throttling not shown in the form);
  3. **RPC**: settings.describe / settings.mutate (host side; the Web allowlist does not affect this plugin's section, since the section uses the plugin's own config route).

> Config read/write path: settings section → `GET/POST /dsh-messager/config` (webserver route, same-origin check) → host `settings` service (describe redacted view / mutate per-field ops) → settings.yaml. After a write, the `settings/document-updated` event (built-in DSH forwarding) drives the frontend refresh.
>
> 🌐 **i18n**: the section menu and form follow the DSH display language (简体中文 / English); dictionaries are registered in `ctx.locale` (zh/en key sets identical; missing keys fail loud by showing the key name).

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `triggers.interaction` | boolean | `true` | Notify when interaction is needed (approval/question/plan-review) |
| `triggers.completed` | boolean | `true` | Notify when a task completes |
| `triggers.error` | boolean | `true` | Notify when a task errors |
| `system.enabled` | boolean | `true` | System notification channel |
| `system.icon` | string | - | Absolute icon path (node-notifier needs a file path, **and the file must exist**) |
| `system.verbosity` | `minimal\|normal\|detailed` | `normal` | System content verbosity |
| `browser.enabled` | boolean | `true` | Browser notification channel |
| `browser.icon` | string | - | Icon URL or data URL |
| `browser.onlyWhenHidden` | boolean | `true` | Notify only when the page is hidden/unfocused |
| `browser.verbosity` | `minimal\|normal\|detailed` | `normal` | Browser content verbosity |
| `feishu.enabled` | boolean | `false` | Feishu bot (webhook) channel |
| `feishu.webhookUrl` | string | - | Custom bot webhook URL |
| `feishu.secret` | string (secret) | - | Signing secret (bot "security settings - signature") |
| `feishu.timeoutMs` | number | `5000` | Per-request timeout |
| `feishu.verbosity` | `minimal\|normal\|detailed` | `normal` | Card content verbosity |
| `wecom.enabled` | boolean | `false` | WeCom group bot (webhook) channel |
| `wecom.webhookUrl` | string | - | Group bot webhook URL (with `?key=`) |
| `wecom.secret` | string (secret) | - | Signing secret ("security settings - signing", HMAC-SHA256, no URL encoding) |
| `wecom.timeoutMs` | number | `5000` | Per-request timeout |
| `wecom.verbosity` | `minimal\|normal\|detailed` | `normal` | Message content verbosity |
| `discord.enabled` | boolean | `false` | Discord channel (webhook) |
| `discord.webhookUrl` | string | - | Discord webhook URL (`.../api/webhooks/<id>/<token>`) |
| `discord.timeoutMs` | number | `5000` | Per-request timeout |
| `discord.verbosity` | `minimal\|normal\|detailed` | `normal` | Embed content verbosity |
| `dingtalk.enabled` | boolean | `false` | DingTalk custom bot (webhook) channel |
| `dingtalk.webhookUrl` | string | - | Custom bot webhook URL (with `?access_token=`) |
| `dingtalk.secret` | string (secret) | - | Signing secret ("security settings - signing", HMAC-SHA256 + URL encoding) |
| `dingtalk.timeoutMs` | number | `5000` | Per-request timeout |
| `dingtalk.verbosity` | `minimal\|normal\|detailed` | `normal` | Card content verbosity |
| `telegram.enabled` | boolean | `false` | Telegram channel (Bot API) |
| `telegram.botToken` | string (secret) | - | Bot token (from @BotFather) |
| `telegram.chatId` | string | - | Target chat_id (numeric ID or `@channel-username`) |
| `telegram.timeoutMs` | number | `5000` | Per-request timeout |
| `telegram.verbosity` | `minimal\|normal\|detailed` | `normal` | Message content verbosity |
| `dedup.interactionCooldownMs` | number | `10000` | Cooldown for same session/trigger (also the cross-tab dedup window) |
| `dedup.completedDebounceMs` | number | `1000` | Completion debounce (waits for the turn/end reason, merges boundary jitter) |
| `dedup.perChannelPerMinute` | number | `20` | Per-channel per-minute cap (protects against third-party rate limits/spam) |
| `message.titlePrefix` | string | - | Title prefix, e.g. `[DSH]` |
| `message.includeSessionTitle` | boolean | `true` | Include session title in the body |
| `message.guiUrl` | string | `http://127.0.0.1:3080` | "Open" link/button target |

Verbosity: `minimal` = title only; `normal` adds session title/tool name/end reason/error summary; `detailed` adds turn/step, approval reason and the GUI link.

## Trigger signals (event → notification mapping)

| Trigger | Host side (system/feishu/wecom/discord/dingtalk/telegram) | Client side (browser) |
| --- | --- | --- |
| Approval | `session/event` `approval/asked` | summary `pendingInteraction==='approval'` appears |
| Question / plan-review | `session/event` `tool/call` (`ask_user_question`) | `pendingInteraction==='question'/'plan-review'` appears |
| Task completed | `agent/status` running→idle (root sessions only) + `turn/end` reason | summary `running:true→false` and not the current session |
| Task errored | `agent/error` | - (covered by the host side) |

## Channel extension

Add a third-party channel (DingTalk / WeCom / Telegram…) by implementing the `NotifyChannel` interface and registering it in `buildChannels()` in `src/index.ts`:

```ts
export interface NotifyChannel {
  readonly id: string
  send(payload: NotificationPayload): Promise<void>
}
```

## Project structure

```
dsh-messager/
├── package.json          # dsh.bundle + dsh.client dual declarations; exports["./client"]
├── tsconfig.json         # host side (Node)
├── tsconfig.client.json  # client declaration output (lib/types/client)
├── tsdown.config.ts      # client bundle (__ModuleLoader__.load contract)
├── cordis.yml            # local development overlay (host side)
├── cordis.patch.yml      # bundle config layer (applies after install)
├── assets/icon.png       # default notification icon
├── src/
│   ├── index.ts          # host apply: event wiring + settings registration + channel building + route mounting
│   ├── config.ts         # Config schema (shared by Loader config and settings)
│   ├── config-shared.ts  # cross-end shared types for the config route (host/client)
│   ├── config-route.ts   # webserver config route (GET view / POST ops, same-origin check)
│   ├── signals.ts        # event → Signal extraction (pure functions)
│   ├── notify.ts         # dispatch: filter/cooldown/debounce/rate-limit + NotifyChannel interface
│   ├── templates.ts      # verbosity template rendering (pure functions)
│   ├── settings.ts       # settings namespace registration (base = Loader config)
│   ├── channels/         # system (node-notifier), feishu/wecom/discord/dingtalk/telegram (webhook/Bot API + signing)
│   └── client/           # browser side: sessions diff, Notification, settings section, config sync
│       ├── index.ts      # section registration (dynamic order) + browser notifications + config route accessor
│       ├── section.tsx   # "Messenger" settings section component
│       ├── settings-form.tsx  # shared form body (groups + FieldRow + action bar)
│       ├── card-controller.ts # form controller (pure logic, unit-testable)
│       ├── fetch-scope.ts     # fetch adapter for ScopeLike (config route)
│       ├── locales.ts    # zh/en dictionaries (ctx.locale registration)
│       ├── config.ts     # browser-notification config handle (via the config route)
│       └── diff.ts       # session summary diff (pure functions)
└── tests/                # vitest unit tests (126)
```

## Testing

```sh
pnpm test       # 126 unit tests: signal extraction/templates/dispatch/channel payloads & signatures/config parsing/client diff/config route/fetch scope/locale consistency/form gating
pnpm typecheck  # host side
pnpm build      # host tsc + client declarations + client bundle (lib/)
```

## Known limitations

- Browser notifications require site permission; with `onlyWhenHidden=false` they also pop while visible.
- Multi-tab dedup uses a localStorage cooldown; different browsers notify independently.
- Subagent completions are not notified (root sessions only), to avoid noise.
- Channel failures (webhook timeouts, unavailable toasts) are only logged; they don't affect other channels or the plugin.
- Completion/interaction dedup state is in-memory and resets on DSH restart (acceptable).

### System notification (node-notifier) cross-platform prerequisites

`node-notifier` invokes completely different underlying programs on the three platforms:

| Platform | Backend | Prerequisites / differences |
| --- | --- | --- |
| Windows | PowerShell ToastNotification | Built in, nothing to install; `sound` maps reliably only on Windows |
| macOS | terminal-notifier | First use **downloads** a third-party binary, and a logged-in GUI session (Dock present) is required; `sound` has no effect |
| Linux | notify-send (libnotify) | Requires `libnotify-bin` and a **running notification daemon** (GNOME Shell / Plasma / mako / dunst etc.); `sound` has no effect |

- **Icon**: `system.icon` must be an **existing file path**. Windows usually degrades silently on a missing path, but Linux/macOS may fail outright — the channel layer validates existence and falls back to no icon.
- **Environment differences are not plugin bugs**: on Linux without a notification daemon, or macOS unable to download terminal-notifier / not in a GUI session, notifications may not pop or fail silently — check those prerequisites first, not the plugin; on failure the dispatcher logs the concrete error via `logWarn`.

## Roadmap

- Third-party channel extension: email
- Trigger extension: background job completion, goal round completion
- Notification history, per-session mute, do-not-disturb windows

## License

[MIT](LICENSE) © [ly6170](https://github.com/ly6170)
