// 统一的错误提示：所有接口错误只走 Toast（规范 form-validation-timing）。
import { useCallback } from 'react'
import { errorToMessage } from '@/api/client'
import { useToast } from '@/feedback/toast'
import { t } from '@/i18n'

export function useErrorToast() {
  const toast = useToast()
  return useCallback((error: unknown) => toast.show(errorToMessage(error, t.errors)), [toast])
}
