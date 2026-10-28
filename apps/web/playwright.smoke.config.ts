import { defineConfig, devices } from '@playwright/test'

// 部署冒烟测试：不启动本地服务，直接访问 SMOKE_BASE_URL（默认本机 aicmo-v2 web 容器）。
export default defineConfig({
  testDir: './e2e/smoke',
  testMatch: '**/*.smoke.ts',
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.SMOKE_BASE_URL ?? 'http://127.0.0.1:9020',
    ...devices['Desktop Chrome'],
    viewport: { width: 1440, height: 900 },
  },
})
