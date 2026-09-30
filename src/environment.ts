/**
 * 运行环境探测与「智能默认」。
 *
 * 目标：同一份插件在 **DSH Desktop / `dsh web` / 无页面（headless）** 下自动选对
 * 默认通道，但**用户显式设置过的字段永远优先**。
 *
 * 依据（v0.3.6 的桌面版调查结论）：
 * - 桌面版的原生系统通知**只能由窗口里的页面**投递。host 半边跑在
 *   `ELECTRON_RUN_AS_NODE=1` 的子进程里，实测 `require('electron')` 返回
 *   `MODULE_NOT_FOUND` —— 拿不到 Electron 的通知 API，只剩 node-notifier
 *   （Windows 上是 SnoreToast，署名与外观都不是应用本体）。
 *   所以**桌面宿主下 `system` 通道默认关闭**，通知走渲染端（`browser` 通道）。
 * - 「桌面宿主」判定 = Electron 二进制 **且** 本进程被桌面壳以 IPC 托管：
 *   经桌面版自带 CLI（`DeepSeek Harness.exe` + `ELECTRON_RUN_AS_NODE`）跑的
 *   `dsh web` 同样是 Electron 二进制，但没有 IPC 通道、也没有窗口，
 *   那种情况必须保留 `system` 默认开启。
 * - 「用户是否显式设置过」只能靠 `settings.describe().user`：它是原始 partial，
 *   键存在 ⇔ 用户写过（`base` 已套用 schema 默认值，永远是填满的，不能用）。
 */

/** 宿主形态：桌面壳托管的 Electron 宿主 / 普通 Node 宿主。 */
export type HostKind = 'desktop' | 'node'

/** 环境默认值：只含「用户没设置过时才生效」的叶子。 */
export interface EnvironmentDefaults {
  system?: { enabled?: boolean }
}

/**
 * 探测宿主形态（纯函数，输入显式传入便于单测）。
 *
 * @param env - `process.env`（只关心 `ELECTRON_RUN_AS_NODE`）。
 * @param versions - `process.versions`（`electron` 存在即 Electron 二进制）。
 *   以 `unknown` 接收并就地收窄：`NodeJS.ProcessVersions` 没有索引签名，
 *   直接声明 `{ electron?: string }` 反而无法从调用点传入。
 * @param hasIpcChannel - 本进程是否有 IPC 通道（桌面壳 spawn 时带 `ipc` stdio）。
 */
export function detectHostKind(
  env: { ELECTRON_RUN_AS_NODE?: string | undefined },
  versions: unknown,
  hasIpcChannel: boolean,
): HostKind {
  const electron = typeof versions === 'object' && versions !== null
    ? (versions as Record<string, unknown>).electron
    : undefined
  const electronHosted = env.ELECTRON_RUN_AS_NODE === '1' || typeof electron === 'string'
  return electronHosted && hasIpcChannel ? 'desktop' : 'node'
}

/**
 * 环境默认值表。
 *
 * 桌面宿主 → `system` 默认关闭（避免在桌面版里弹 SnoreToast；渲染端的原生通知才是主通道）。
 * 其它宿主 → 空对象（保持 schema 默认值，即 system 开启，行为与 v0.3.5 一致）。
 */
export function environmentDefaults(kind: HostKind): EnvironmentDefaults {
  return kind === 'desktop' ? { system: { enabled: false } } : {}
}

/**
 * 用户层是否**显式设置过**该路径。
 *
 * ⚠️ 必须逐段 `Object.hasOwn`：用户可能显式设 `false`，用真值判断会把
 * 「关掉」误判成「没设置」。路径上任何一段缺失即为没设置过。
 *
 * 📌 该等价关系（「键存在 ⇔ 用户写过」）依赖 DSH settings 的投影行为：
 * `describe().user` 来自 profile patch 的原始 config 经 `projectForm` 投影，
 * 而 `projectForm` **丢弃值为 undefined 的键**（packages/settings/settings/src/schema.ts）。
 * 若上游改成保留 undefined 键，这里的判断需要跟着调整。
 */
export function userSet(user: unknown, path: readonly string[]): boolean {
  let node: unknown = user
  for (const key of path) {
    if (typeof node !== 'object' || node === null || !Object.hasOwn(node, key)) return false
    node = (node as Record<string, unknown>)[key]
  }
  return true
}

/**
 * 把环境默认值铺在有效配置上：只有用户没显式设置过的叶子会被覆盖。
 *
 * @param effective - 已合并好的有效配置（schema 默认 → base → user）。
 * @param user - `settings.describe().user`（原始 partial）；调用方需保证它**可知**
 *   （服务缺席时应直接不调用本函数，而不是传 undefined —— 那会把用户的显式设置覆盖掉）。
 * @param defaults - {@link environmentDefaults} 的结果。
 */
export function applyEnvironmentDefaults<T extends object>(
  effective: T,
  user: unknown,
  defaults: EnvironmentDefaults,
): T {
  const result = structuredClone(effective) as Record<string, unknown>
  for (const [group, fields] of Object.entries(defaults)) {
    const target = result[group]
    if (typeof target !== 'object' || target === null) continue
    for (const [field, value] of Object.entries(fields as Record<string, unknown>)) {
      if (userSet(user, [group, field])) continue
      ;(target as Record<string, unknown>)[field] = value
    }
  }
  return result as T
}
