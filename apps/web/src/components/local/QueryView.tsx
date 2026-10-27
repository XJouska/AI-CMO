// 数据页面的四种状态：加载中、错误（弱网）、空态、正常内容。
// 加载用正式 Loading，错误与空态用正式 EmptyPage，均相对整屏垂直居中（规范 page-empty / page-weak-network）。
import type { ReactNode } from 'react'
import { EmptyPage, Loading } from '@yb/generated/components'
import { t } from '@/i18n'
import { PageCenter } from './StackPage'

interface QueryLike<T> {
  data: T | undefined
  isPending: boolean
  isError: boolean
  refetch: () => unknown
}

interface QueryViewProps<T> {
  query: QueryLike<T>
  isEmpty?: (data: T) => boolean
  empty?: { title: string; desc: string; action?: string; onAction?: () => void }
  children: (data: T) => ReactNode
}

export function QueryView<T>({ query, isEmpty, empty, children }: QueryViewProps<T>) {
  if (query.isPending) {
    return (
      <PageCenter>
        <Loading>{t.common.loading}</Loading>
      </PageCenter>
    )
  }
  if (query.isError || query.data === undefined) {
    return (
      <PageCenter>
        <EmptyPage
          buttonLabel={t.common.retry}
          descText={t.common.networkErrorDesc}
          illus="networkError"
          onAction={(action) => {
            if (action === 'press') void query.refetch()
          }}
        >
          {t.common.networkErrorTitle}
        </EmptyPage>
      </PageCenter>
    )
  }
  if (empty && isEmpty?.(query.data)) {
    return (
      <PageCenter>
        <EmptyPage
          button={Boolean(empty.action)}
          buttonLabel={empty.action}
          descText={empty.desc}
          illus="noContent"
          onAction={(action) => {
            if (action === 'press') empty.onAction?.()
          }}
        >
          {empty.title}
        </EmptyPage>
      </PageCenter>
    )
  }
  return <>{children(query.data)}</>
}
