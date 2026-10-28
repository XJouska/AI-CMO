import { defineConfig, devices } from '@playwright/test'

// 端到端测试：
// - 后端：scripts/e2e-backend.sh（独立 e2e 数据库 + 假外部服务，端口 18000）
// - 前端：vite 生产构建 + preview（端口 14173，/api 代理到 18000）
// 串行执行、单 worker（机器内存有限）。截图基线在 e2e/__screenshots__。
const API_PORT = 18000
const WEB_PORT = 14173

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  snapshotPathTemplate: '{testDir}/__screenshots__/{testFilePath}/{arg}-{projectName}{ext}',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.01, animations: 'disabled', caret: 'hide' } },
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${WEB_PORT}`,
    trace: 'retain-on-failure',
    locale: 'zh-CN',
    colorScheme: 'light',
  },
  projects: [
    { name: 'mobile', use: { ...devices['Desktop Chrome'], viewport: { width: 402, height: 874 }, deviceScaleFactor: 1 } },
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 } },
  ],
  webServer: [
    {
      command: 'bash ../../backend/scripts/e2e-backend.sh',
      url: `http://127.0.0.1:${API_PORT}/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { E2E_API_PORT: String(API_PORT) },
    },
    {
      command: `npx vite build --logLevel warn && node ../../scripts/prune-dist-assets.mjs dist && npx vite preview --host 127.0.0.1 --port ${WEB_PORT} --strictPort`,
      url: `http://127.0.0.1:${WEB_PORT}`,
      reuseExistingServer: false,
      timeout: 180_000,
      env: { VITE_API_PROXY: `http://127.0.0.1:${API_PORT}` },
    },
  ],
})
