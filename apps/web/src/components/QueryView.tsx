// 数据页面的四种状态：加载中、错误（弱网）、空态、正常内容。
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { t } from '@/i18n'
import { Centered, EmptyState, ErrorState, Spinner } from '@/ui'

interface QueryLike<T> {
  data: T | undefined
  isPending: boolean
  isError: boolean
  refetch: () => unknown
}

interface QueryViewProps<T> {
  query: QueryLike<T>
  isEmpty?: (data: T) => boolean
  empty?: { title: string; desc: string; action?: string; onAction?: () => void; icon?: LucideIcon }
  children: (data: T) => ReactNode
}

export function QueryView<T>({ query, isEmpty, empty, children }: QueryViewProps<T>) {
  if (query.isPending) {
    return (
      <Centered>
        <Spinner label={t.common.loading} />
      </Centered>
    )
  }
  if (query.isError || query.data === undefined) {
    return (
      <Centered>
        <ErrorState actionLabel={t.common.retry} description={t.common.networkErrorDesc} onRetry={() => void query.refetch()} title={t.common.networkErrorTitle} />
      </Centered>
    )
  }
  if (empty && isEmpty?.(query.data)) {
    return (
      <Centered>
        <EmptyState actionLabel={empty.action} description={empty.desc} icon={empty.icon} onAction={empty.onAction} title={empty.title} />
      </Centered>
    )
  }
  return <>{children(query.data)}</>
}
