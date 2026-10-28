// 统一的错误提示：所有接口错误只走 Toast（规范 form-validation-timing）。
import { useCallback } from 'react'
import { ApiError, errorToMessage } from '@/api/client'
import { useToast } from '@/feedback/toast'
import { t } from '@/i18n'

/** 套餐限额 / 到期（402）：在后端文案后附上升级入口说明。 */
export function quotaHint(error: unknown): string {
  return error instanceof ApiError && error.status === 402 ? `（${t.errors.upgradeHint}）` : ''
}

export function useErrorToast() {
  const toast = useToast()
  return useCallback((error: unknown) => toast.show(errorToMessage(error, t.errors) + quotaHint(error)), [toast])
}
