/**
 * 系统通知通道：OS 级 toast（Windows / macOS / Linux），经 node-notifier 投递。
 *
 * node-notifier 在三个平台调用的是完全不同的底层程序：
 * - Windows：PowerShell ToastNotification（内建，无需额外安装）；
 * - macOS：terminal-notifier（第三方二进制，首次使用需联网下载，且需登录图形会话）；
 * - Linux：notify-send（libnotify，需 libnotify-bin 与一个运行中的通知守护进程）。
 *
 * 因此同一份载荷落在不同平台上语义不一致，这里按平台分流：
 * - sound 只在 Windows 有可靠映射（macOS/Linux 的底层不支持内建声音，强制传可能
 *   引起差异，故仅在 win32 传递）；
 * - icon 必须是存在的文件路径：Linux 的 notify-send 与 macOS 的 terminal-notifier
 *   对缺失/非法路径的处理与 Windows 不同，可能直接失败而非降级，故先做存在性校验，
 *   无效时降级为不带图标；
 * - 发送失败时尝试一次「去掉图标」的重试（很多 Linux/macOS 失败由图标引起），
 *   再交给调度层记录。
 *
 * 失败最终由调度层兜底记录（notify.ts 的 logWarn），不抛出到事件监听器。
 */

import { existsSync } from 'node:fs'
import notifier from 'node-notifier'
import type { NotifyChannel, NotificationPayload } from '../notify.js'

export interface SystemChannelOptions {
  /** 图标绝对路径（node-notifier 需要文件路径且该文件必须存在）。 */
  icon?: string
}

/**
 * buildOptions 返回的可投递载荷。
 * 兼容三平台各自 notify() 重载（base/sound 字段的组合即可结构上匹配
 * notifier.Notification / NotifySend.Notification / WindowsToaster.Notification）。
 */
type SystemNotifyOptions = {
  title: string
  message?: string
  icon?: string
  wait: false
  sound?: boolean
}

/** 平台分立的载荷拼接：sound / icon 语义随平台、底层程序不同。 */
function buildOptions(
  payload: NotificationPayload,
  rawIcon: string | undefined,
): SystemNotifyOptions {
  // 图标只在存在时传入；不存在时整段省略，避免 Linux/macOS 直接报错。
  const icon = rawIcon !== undefined && rawIcon !== '' && existsSync(rawIcon) ? rawIcon : undefined
  const common: Omit<SystemNotifyOptions, 'sound'> = {
    title: payload.title,
    ...(payload.body === '' ? {} : { message: payload.body }),
    ...(icon === undefined ? {} : { icon }),
    wait: false,
  }
  switch (process.platform) {
    case 'win32':
      // Windows Toast 对 sound 有完整支持。
      return { ...common, sound: true }
    case 'darwin':
    case 'linux':
    default:
      // macOS 用 terminal-notifier，Linux 用 notify-send：均无内建可靠声音参数。
      return common
  }
}

function deliver(options: SystemNotifyOptions): Promise<void> {
  return new Promise((resolve, reject) => {
    notifier.notify(options, (error) => {
      if (error !== null) reject(error)
      else resolve()
    })
  })
}

export function createSystemChannel(options: SystemChannelOptions = {}): NotifyChannel {
  return {
    id: 'system',
    async send(payload: NotificationPayload): Promise<void> {
      try {
        await deliver(buildOptions(payload, options.icon))
      } catch (error) {
        // 降级重试：去掉图标再发一次，兜住由 icon 路径引发的 Linux/macOS 失败。
        // 若仍失败则抛出，由调度层记录；不在此处吞掉也不抛出到事件监听器。
        try {
          await deliver(buildOptions(payload, undefined))
        } catch {
          throw error
        }
      }
    },
  }
}
