import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// 样式顺序：设计变量 → 基础样式 → 组件 → 布局 → 页面
import './ui/tokens.css'
import './ui/base.css'
import './ui/ui.css'
import './app/app.css'
import './pages/home.css'
import './pages/pages.css'
import { App } from './app/App'

const root = document.getElementById('root')
if (!root) throw new Error('缺少 #root 节点')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
