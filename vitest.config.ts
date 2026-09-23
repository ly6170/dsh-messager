import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.spec.ts'],
  },
  resolve: {
    alias: {
      // ⚠️ 测试绝不允许投递真实 OS 通知。
      // 系统通道的 schema 默认值就是 enabled=true，测试一旦触发投递就会真的弹
      // Windows toast（SnoreToast）。曾因此产生噪音并被误判为运行时故障。
      // 这里把 node-notifier 全局换成 no-op 桩（记录到 tests/stubs 的 delivered）。
      'node-notifier': fileURLToPath(new URL('./tests/stubs/node-notifier.ts', import.meta.url)),
    },
  },
})
