/**
 * 桌面版（DSH Desktop）窗口判定。
 *
 * 官方标记：桌面壳的 preload 在窗口里 `contextBridge.exposeInMainWorld('dshDesktopBoot', …)`
 * （asar 内 `lib/preload-app.cjs`）；DSH 自己的前端也用
 * `globalThis.dshDesktopBoot !== undefined` 决定 boot 通道（桌面走 IPC 取启动清单，
 * 浏览器读 HTML 里的 `__DSH_BOOT__`）。所以这是「我在桌面窗口里」的权威信号。
 *
 * ⚠️ 仅 client 端可用（host 端没有 window；host 侧的等价判定见 src/environment.ts）。
 */

/** 判断给定全局对象是否处于桌面版窗口（可传替身便于单测）。 */
export function isDesktopWindow(target: unknown = globalThis): boolean {
  return typeof target === 'object' && target !== null && 'dshDesktopBoot' in target
}

/**
 * 「用户现在没在看这个窗口」判定 —— 决定 `onlyWhenHidden` 是否放行通知。
 *
 * - 浏览器（`dsh web`）：页面 `hidden`（切走标签页 / 最小化）即为没在看；
 * - **桌面版：`visibilityState` 只在窗口最小化或被隐藏时才变 `hidden`**，
 *   窗口被别的窗口盖住、失去焦点时它仍是 `visible`。若只看 `visibilityState`，
 *   用户切到别的应用去干活时永远不会收到通知 —— 所以桌面版把**失去焦点**也算没在看。
 *
 * @param options.desktop - 是否桌面版窗口（见 isDesktopWindow）。
 * @param options.visibilityState - `document.visibilityState`。
 * @param options.hasFocus - `document.hasFocus()`。
 */
export function isWindowBackgrounded(options: {
  desktop: boolean
  visibilityState: string
  hasFocus: boolean
}): boolean {
  if (options.visibilityState === 'hidden') return true
  return options.desktop && !options.hasFocus
}
