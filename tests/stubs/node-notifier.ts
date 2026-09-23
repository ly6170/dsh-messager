/**
 * `node-notifier` 的测试桩：**绝不投递真实 OS 通知**。
 *
 * 背景（真实事故）：测试里系统通道一旦开启（`system.enabled` 的 schema 默认值就是
 * `true`），`pnpm test` 就会真的往开发机弹系统通知 —— Windows 上是 SnoreToast。
 * 更糟的是这些噪音会被误判成「插件运行时故障」，浪费大量排查时间。
 *
 * 本桩经 `vitest.config.ts` 的 `resolve.alias` **全局生效**，
 * 因此任何测试（包括未来新增的）都不可能再触发真实 toast。
 * 投递内容记录在 `delivered` 里，需要时可断言。
 */

/** 一次被拦下的投递。 */
export interface StubNotification {
  title: string
  message?: string
  icon?: string
  sound?: boolean
  wait?: boolean
}

/** 被拦下的投递记录（跨用例累积，供断言）。 */
export const delivered: StubNotification[] = []

/** 清空记录（需要隔离的用例自行调用）。 */
export function resetDelivered(): void {
  delivered.length = 0
}

function notify(options: StubNotification, callback?: (error: Error | null) => void): void {
  delivered.push(options)
  callback?.(null)
}

export default { notify }
export { notify }
