#!/usr/bin/env node
// Reapply the dsh-messager platform patch after a harness reinstall/update.
//
// DeepSeek Harness gates which settings namespaces configuration clients may
// read/write behind a hard-coded allowlist in `dsh-host-apiproxy`
// (`WEB_SETTINGS_NAMESPACES`). Third-party plugin namespaces are refused with
// `settings-not-exposed` until they are added there, so the messager settings
// card (设置 → 插件) cannot persist without this one-line platform patch.
//
// This script locates the installed `@deepseek-ai/dsh-host-apiproxy` package
// (resolved the same way the running `dsh` process resolves it), and
// idempotently adds `"messager"` to that allowlist. Run it once after any
// harness install/update, then restart the server.
//
//   node patch-host.mjs            # patch (no-op if already patched)
//   node patch-host.mjs --check    # only report status, make no changes
//   node patch-host.mjs --revert   # remove the dsh-messager entry again
//
// 用法（发行版 / npx 安装的 DSH）：在插件被安装到的 profile 内执行
//   node node_modules/dsh-messager/patch-host.mjs
// 源码运行（pnpm dsh）的 DSH 不需要本脚本：白名单已在源码 checkout 中
// 加入 'messager'（packages/host/apiproxy/src/api-proxy.ts）。
//
// 本脚本改编自 dsh-skin 插件的同类补丁（MIT）。

import { createRequire } from 'node:module'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

/** 本脚本拥有的标记注释行与白名单条目。 */
const MARKER = '// dsh-messager: third-party plugin-owned settings namespace'
const PATCH_BLOCK = `\t${MARKER}\n\t"messager"`

/**
 * 解析安装的 apiproxy 包：优先从脚本所在目录向上解析（插件以包身份安装
 * 在 profile 的 node_modules 时命中），再从当前工作目录解析兜底。
 */
function resolveApiproxyPackage() {
  const candidates = [here, process.cwd()]
  for (const base of candidates) {
    try {
      const req = createRequire(join(base, 'x.js'))
      return req.resolve('@deepseek-ai/dsh-host-apiproxy/package.json')
    } catch {
      // 该目录向上找不到，尝试下一个候选
    }
  }
  return undefined
}

const pkgPath = resolveApiproxyPackage()
if (pkgPath === undefined) {
  console.error('✗ cannot resolve @deepseek-ai/dsh-host-apiproxy from', here)
  console.error('  install dsh-messager into a profile that bundles the web app (see README), then retry.')
  console.error('  源码运行（pnpm dsh）的 DSH 无需本脚本。')
  process.exit(1)
}
const lib = join(dirname(pkgPath), 'lib', 'index.js')
if (!existsSync(lib)) {
  console.error('✗ dsh-host-apiproxy lib/index.js not found at', lib)
  process.exit(1)
}

const source = readFileSync(lib, 'utf8')
/** True when the allowlist already contains the messager entry, whatever comment format. */
const hasMessager = /WEB_SETTINGS_NAMESPACES = \[[^\]]*"messager"/.test(source)

const mode = process.argv[2] ?? ''
if (mode === '--check') {
  console.log(hasMessager
    ? `✓ patched — "messager" present in WEB_SETTINGS_NAMESPACES (${lib})`
    : `✗ not patched — "messager" missing from WEB_SETTINGS_NAMESPACES (${lib})`)
  process.exit(hasMessager ? 0 : 1)
}

if (mode === '--revert') {
  if (!hasMessager) {
    console.log('nothing to revert — dsh-messager entry not present.')
    process.exit(0)
  }
  // Remove our marker + "messager" block right before the array's closing bracket
  // (with the comma we may have added when the last built-in entry lacked one).
  // Version-agnostic: does not depend on which built-in entries exist.
  const next = source.replace(
    /(WEB_SETTINGS_NAMESPACES = \[[\s\S]*?)(?:,\n\t|\n\t)(?:\/\/[^\n]*\n\t)*"messager"(?=\n\t?\])/,
    '$1',
  )
  if (next === source) {
    console.error('✗ could not revert automatically — remove the "messager" entry manually in', lib)
    process.exit(1)
  }
  writeFileSync(lib, next)
  console.log('✓ reverted — removed the dsh-messager entry from WEB_SETTINGS_NAMESPACES.')
  console.log('  restart the server for the change to take effect.')
  process.exit(0)
}

if (hasMessager) {
  console.log('✓ already patched — nothing to do.')
  process.exit(0)
}

// Anchor: the WEB_SETTINGS_NAMESPACES array's closing bracket. Insert the
// messager entry right before it, so the patch works on any harness version
// regardless of which built-in entries the allowlist contains. If the last
// built-in entry lacks a trailing comma (some published builds do), add one
// first so the patched array stays valid JavaScript.
const anchor = /(WEB_SETTINGS_NAMESPACES = \[[\s\S]*?\n)(\t?\])/
if (!anchor.test(source)) {
  console.error('✗ could not locate the WEB_SETTINGS_NAMESPACES array — the harness layout may have changed.')
  console.error('  Open this file and add "messager" to the array manually:')
  console.error('  ', lib)
  process.exit(1)
}

const next = source.replace(anchor, (whole, head, tail) => {
  const needsComma = !/,\s*$/.test(head)
  const body = needsComma ? `${head.replace(/\s+$/, '')},\n` : head
  return `${body}${PATCH_BLOCK}\n${tail}`
})
writeFileSync(lib, next)
console.log('✓ patched — added "messager" to WEB_SETTINGS_NAMESPACES in', lib)
console.log('  restart the server for the change to take effect.')
