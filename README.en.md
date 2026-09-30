# dsh-messager

[简体中文](README.md) | [English](README.en.md)

A task notification plugin for DeepSeek Harness (DSH). Get system, browser, Feishu, WeCom, Discord, DingTalk, or Telegram notifications when a session needs approval or input, a task completes, or a task fails.

## Compatibility

**v0.3.6 supports DSH `0.2.0-rc.1` and compatible later 0.2.x releases.** Keep the matching older plugin version for DSH 0.1.x. Upgrade DSH before installing this version; existing notification settings need no migration.

## Install

**DSH desktop app:** Open **Plugins** in the top-left corner, choose **Add plugin**, enter `dsh-messager`, and install it. Restart DSH after installation.

**CLI (npm package):** Requires Node.js 20+, pnpm, and the DSH CLI. Install into the Web profile:

```sh
dsh plugin --profile web add dsh-messager
dsh web
```

When running DSH from its source repository, use `pnpm dsh` instead of `dsh`. Restart DSH if it was already running.

**From source** (optional for developers):

```sh
git clone https://github.com/ly6170/dsh-messager.git
cd dsh-messager
pnpm install
pnpm build
dsh plugin --profile web add .
dsh web
```

## Use

Open **Settings → Messenger** (「通知&信使」), choose the events and channels you want, enter any webhook or bot credentials, and save. Browser notifications are enabled by default. System notifications default to off in the desktop app and on elsewhere; third-party channels default to off. Browser or app notifications require the corresponding permission.

Notifications cover interactions, root-session task completion, and task errors. Running status does not trigger a notification. In the desktop app, losing window focus can also trigger completion notices for the open session. Push messages no longer include links. Saved settings take effect immediately.

## Troubleshooting

- **Settings section missing or config route returns 404:** Check the active `web` profile, restart DSH, and verify DSH/plugin version compatibility.
- **No browser notification:** Check site permission. By default, notifications appear only when the page is hidden or unfocused.
- **No desktop notification:** Check app notification permission. If the system drops the app's notifications, enable the **System notifications** channel in settings as a fallback.
- **Settings unavailable with `--patch`:** That development mode loads only the host side. Install with `dsh plugin add` to use the settings page.

[中文](README.md) · [MIT License](LICENSE)
