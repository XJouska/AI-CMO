// 全局 Toast：同一时间只显示一条，3 秒后自动消失。挂在 document.body 底部居中。
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export const TOAST_DURATION_MS = 3000

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

  const show = useCallback((message: string) => setCurrent({ id: Date.now(), message }), [])
  const api = useMemo(() => ({ show }), [show])

  return (
    <ToastContext.Provider value={api}>
      {children}
      {current
        ? createPortal(
            <div aria-live="polite" className="ui-toast-region" role="status">
              <div className="ui-toast" key={current.id}>
                {current.message}
              </div>
            </div>,
            document.body,
          )
        : null}
    </ToastContext.Provider>
  )
}

export function useToast(): ToastApi {
  const api = useContext(ToastContext)
  if (!api) throw new Error('useToast 必须在 ToastProvider 内使用')
  return api
}
