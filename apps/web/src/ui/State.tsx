import { Inbox, Loader2, WifiOff, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from './Button'
import { cx } from './cx'

export function Spinner({ label, size = 20, className }: { label?: string; size?: number; className?: string }) {
  return (
    <span className={cx('ui-spinner', className)} role="status">
      <Loader2 aria-hidden className="ui-spin" size={size} />
      {label ? <span className="ui-spinner__label">{label}</span> : <span className="sr-only">加载中</span>}
    </span>
  )
}

/** 页面级加载 / 空态容器：在内容区垂直居中。 */
export function Centered({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('ui-centered', className)}>{children}</div>
}

export function Skeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div aria-hidden className="ui-skeleton">
      {Array.from({ length: lines }, (_, index) => (
        <span key={index} style={{ width: `${index === lines - 1 ? 60 : 100}%` }} />
      ))}
    </div>
  )
}

export interface EmptyStateProps {
  title: string
  description?: ReactNode
  icon?: LucideIcon
  actionLabel?: string
  onAction?: () => void
  actionLoading?: boolean
  secondary?: ReactNode
  className?: string
}

export function EmptyState({ title, description, icon: Icon = Inbox, actionLabel, onAction, actionLoading, secondary, className }: EmptyStateProps) {
  return (
    <div className={cx('ui-empty', className)}>
      <span aria-hidden className="ui-empty__icon">
        <Icon size={24} />
      </span>
      <h3 className="ui-empty__title">{title}</h3>
      {description ? <p className="ui-empty__desc">{description}</p> : null}
      {actionLabel ? (
        <div className="ui-empty__actions">
          <Button loading={actionLoading} onClick={onAction} variant="primary">
            {actionLabel}
          </Button>
          {secondary}
        </div>
      ) : null}
    </div>
  )
}

export function ErrorState({ title, description, actionLabel, onRetry }: { title: string; description?: string; actionLabel: string; onRetry: () => void }) {
  return (
    <div className="ui-empty">
      <span aria-hidden className="ui-empty__icon ui-empty__icon--danger">
        <WifiOff size={24} />
      </span>
      <h3 className="ui-empty__title">{title}</h3>
      {description ? <p className="ui-empty__desc">{description}</p> : null}
      <div className="ui-empty__actions">
        <Button onClick={onRetry} variant="outline">
          {actionLabel}
        </Button>
      </div>
    </div>
  )
}
