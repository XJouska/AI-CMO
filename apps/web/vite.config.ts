import path from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig, type Alias } from 'vite'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '../..')
const ybRoot = path.join(repoRoot, 'packages', 'yb-ui')

export default defineConfig(({ command }) => {
  const aliases: Alias[] = [
    { find: /^@yb-ext\//, replacement: `${path.join(ybRoot, 'extensions')}/` },
    { find: /^@yb\//, replacement: `${path.join(ybRoot, 'demo', 'src')}/` },
    { find: /^@\//, replacement: `${path.join(here, 'src')}/` },
  ]
  // 生产构建不打包设计包随附字体：把 tokens.css 中的 `@import "./fonts.css"` 换成只用系统字体的空声明。
  // 原因见 docs/licensing.md。开发环境仍使用本地字体（文件不入库，由 vendor 脚本放置）。
  if (command === 'build') {
    aliases.unshift({ find: /^\.\/fonts\.css$/, replacement: path.join(ybRoot, 'extensions', 'fonts.system.css') })
  }

  return {
    plugins: [react()],
    // 设计包的图标、插画、图片按根路径引用（例如 /icons/chevron-right.svg），所以直接作为静态目录。
    publicDir: path.join(ybRoot, 'demo', 'public'),
    resolve: { alias: aliases },
    server: {
      fs: { allow: [repoRoot] },
      proxy: {
        '/api': { target: process.env.VITE_API_PROXY ?? 'http://127.0.0.1:8000', changeOrigin: false },
      },
    },
    preview: {
      proxy: {
        '/api': { target: process.env.VITE_API_PROXY ?? 'http://127.0.0.1:8000', changeOrigin: false },
      },
    },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      sourcemap: false,
    },
  }
})
