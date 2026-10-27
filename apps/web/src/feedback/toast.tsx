// 全局 Toast：同一时间只显示一条，3 秒后自动消失。
// 使用正式 Toast 组件，挂载在 HostCanvas 内的 FeedbackLayer 上（由 HostCanvas 提供挂载点）。
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Toast } from '@yb/generated/components'
import { FeedbackLayer } from '@yb/library/DeviceOverlays'

const TOAST_DURATION_MS = 3000

interface ToastApi {
  show: (message: string) => void
}

const ToastContext = createContext<ToastApi | null>(null)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<{ id: number; message: string } | null>(null)

  useEffect(() => {
    if (!current) return
    const timer = window.setTimeout(() => setCurrent(null), TOAST_DURATION_MS)
    return () => window.clearTimeout(timer)
  }, [current])

  // 新消息直接替换旧消息并重新计时（id 变化会触发 effect 重置定时器）。
  const show = useCallback((message: string) => setCurrent({ id: Date.now(), message }), [])
  const api = useMemo(() => ({ show }), [show])

  return (
    <ToastContext.Provider value={api}>
      {children}
      {current ? (
        <FeedbackLayer kind="toast">
          <Toast key={current.id} type="Default">
            {current.message}
          </Toast>
        </FeedbackLayer>
      ) : null}
    </ToastContext.Provider>
  )
}

export function useToast(): ToastApi {
  const api = useContext(ToastContext)
  if (!api) throw new Error('useToast 必须在 ToastProvider 内使用')
  return api
}
