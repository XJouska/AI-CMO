// 应用壳：
// - 手机（宽度 ≤ 480px）：画布铺满视口
// - 桌面：402×874 设备画布居中，外部背景为 --yb-color-basic-bg-secondary
// - 画布使用正式 HostCanvas（canvasRole="primary"），它提供 ModalLayer / FeedbackLayer 的挂载点
import type { ReactNode } from 'react'
import { HostCanvas } from '@yb/library/HostCanvas'
import { ToastProvider } from '@/feedback/toast'
import { useSystemTheme } from './theme'

export function AppShell({ children }: { children: ReactNode }) {
  const theme = useSystemTheme()
  return (
    <div className="app-stage" data-theme={theme}>
      <HostCanvas canvasRole="primary" className="app-canvas" data-theme={theme}>
        <ToastProvider>{children}</ToastProvider>
      </HostCanvas>
    </div>
  )
}
