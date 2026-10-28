import path from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

const here = path.dirname(fileURLToPath(import.meta.url))

// 组件测试：jsdom 环境渲染页面，断言交互状态与渲染安全。CSS 不参与测试。
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [{ find: /^@\//, replacement: `${path.join(here, 'src')}/` }],
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.spec.tsx', 'src/**/*.spec.ts'],
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    restoreMocks: true,
    pool: 'threads',
    maxWorkers: 2,
  },
})
