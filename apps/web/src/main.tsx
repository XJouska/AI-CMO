import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// 设计系统样式顺序：tokens → 基础重置 → 组件样式（随 App 中的组件导入）→ 本地扩展 → 应用布局
import '@yb/tokens.css'
import '@yb/index.css'
import { App } from './app/App'
import '@yb-ext/canvas-fit.css'
import './app/app.css'

const root = document.getElementById('root')
if (!root) throw new Error('缺少 #root 节点')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
