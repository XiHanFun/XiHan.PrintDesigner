import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // 单条用例的超时上限，约为本机最慢一条的十倍
    testTimeout: 45_000,
  },
})
