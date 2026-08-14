/**
 * 客户端 bundle 构建（复刻 DSH 内部 preset 的浏览器契约）：
 * - 产物 lib/client.js，closure 工厂交给 window.__ModuleLoader__.load
 *   （与 packages/client/tsdown.client.ts 的 banner/footer 一致）；
 * - CJS、browser 平台；
 * - external：react / react/jsx-runtime（平台种子词，浏览器模块表内），
 *   其余依赖全部内联（deps.alwaysBundle）——任何未内联的外部 require 都会在
 *   运行时抛 "missed the module table"；
 * - define 替换 NODE_ENV / import.meta.env（zustand 等依赖探测）。
 */
import { defineConfig } from 'tsdown'

const PLUGIN_ID = 'dsh-messager'

/** 平台模块表中的外部模块（本插件运行期只用 react）。 */
const CLIENT_EXTERNALS = ['react', 'react/jsx-runtime', '@deepseek-ai/dsh-client-ui-primitives']

export default defineConfig({
  entry: { client: 'src/client/index.ts' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  dts: false,
  sourcemap: true,
  clean: false,
  deps: {
    neverBundle: CLIENT_EXTERNALS,
    alwaysBundle: (id) => !CLIENT_EXTERNALS.includes(id),
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
  },
  outputOptions: {
    entryFileNames: 'client.js',
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PLUGIN_ID)}, factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
})
