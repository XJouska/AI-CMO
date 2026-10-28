import { ChevronRight, MoreHorizontal, type LucideIcon } from 'lucide-react'
import type { HTMLAttributes, KeyboardEvent, ReactNode } from 'react'
import { cx } from './cx'

/* ---------- Card ---------- */

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  padding?: 'none' | 'sm' | 'md' | 'lg'
  interactive?: boolean
}

export function Card({ padding = 'md', interactive, className, children, ...rest }: CardProps) {
  return (
    <div {...rest} className={cx('ui-card', `ui-card--pad-${padding}`, interactive && 'ui-card--interactive', className)}>
      {children}
    </div>
  )
}

export function CardHeader({ title, description, actions, icon: Icon }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; icon?: LucideIcon }) {
  return (
    <div className="ui-card__header">
      {Icon ? (
        <span aria-hidden className="ui-card__icon">
          <Icon size={18} />
        </span>
      ) : null}
      <div className="ui-card__heading">
        <h3 className="ui-card__title">{title}</h3>
        {description ? <p className="ui-card__desc">{description}</p> : null}
      </div>
      {actions ? <div className="ui-card__actions">{actions}</div> : null}
    </div>
  )
}

/* ---------- List ---------- */

export function SectionTitle({ children, actions, className }: { children: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <div className={cx('ui-section-title', className)}>
      <h2>{children}</h2>
      {actions ? <div className="ui-section-title__actions">{actions}</div> : null}
    </div>
  )
}

export function ListGroup({ title, children, className, actions }: { title?: ReactNode; children: ReactNode; className?: string; actions?: ReactNode }) {
  return (
    <section className={cx('ui-list-group', className)}>
      {title ? <SectionTitle actions={actions}>{title}</SectionTitle> : null}
      <div className="ui-list">{children}</div>
    </section>
  )
}

export interface ListRowProps {
  title: ReactNode
  subtitle?: ReactNode
  meta?: ReactNode
  /** 右侧文字 */
  value?: ReactNode
  /** 右侧自定义内容（按钮、开关等） */
  trailing?: ReactNode
  icon?: LucideIcon
  dot?: boolean
  /** 点击整行（显示箭头） */
  onClick?: () => void
  /** 「更多」按钮 */
  onMore?: () => void
  moreLabel?: string
  chevron?: boolean
  danger?: boolean
  active?: boolean
  className?: string
  /** 传给行容器的 data-* 属性 */
  data?: Record<string, string | boolean | undefined>
}

export function ListRow({ title, subtitle, meta, value, trailing, icon: Icon, dot, onClick, onMore, moreLabel = '更多', chevron, danger, active, className, data }: ListRowProps) {
  const clickable = Boolean(onClick)
  const showChevron = chevron ?? clickable
  const dataAttrs: Record<string, string> = {}
  for (const [key, v] of Object.entries(data ?? {})) {
    if (v === undefined || v === false) continue
    dataAttrs[`data-${key}`] = v === true ? '' : v
  }
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!clickable || event.target !== event.currentTarget) return
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onClick?.()
    }
  }
  return (
    <div
      {...dataAttrs}
      aria-current={active ? 'true' : undefined}
      className={cx('ui-row', clickable && 'ui-row--clickable', danger && 'ui-row--danger', active && 'is-active', className)}
      onClick={onClick}
      onKeyDown={onKeyDown}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
    >
      {Icon ? (
        <span aria-hidden className="ui-row__icon">
          <Icon size={18} />
        </span>
      ) : null}
      <div className="ui-row__main">
        <div className="ui-row__title">
          <span>{title}</span>
          {dot ? <span aria-label="未读" className="ui-dot" role="img" /> : null}
        </div>
        {subtitle ? <div className="ui-row__subtitle">{subtitle}</div> : null}
        {meta ? <div className="ui-row__meta">{meta}</div> : null}
      </div>
      {value !== undefined && value !== null && value !== '' ? <div className="ui-row__value">{value}</div> : null}
      {trailing ? (
        <div className="ui-row__trailing" onClick={(event) => event.stopPropagation()}>
          {trailing}
        </div>
      ) : null}
      {onMore ? (
        <button
          aria-label={moreLabel}
          className="ui-row__more"
          onClick={(event) => {
            event.stopPropagation()
            onMore()
          }}
          type="button"
        >
          <MoreHorizontal aria-hidden size={18} />
        </button>
      ) : null}
      {showChevron && !onMore ? <ChevronRight aria-hidden className="ui-row__chevron" size={16} /> : null}
    </div>
  )
}

/* ---------- Tag / Badge / Dot ---------- */

export type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger'

export function Tag({ tone = 'neutral', children, icon: Icon, className }: { tone?: Tone; children: ReactNode; icon?: LucideIcon; className?: string }) {
  return (
    <span className={cx('ui-tag', `ui-tag--${tone}`, className)}>
      {Icon ? <Icon aria-hidden size={12} /> : null}
      {children}
    </span>
  )
}

export function CountBadge({ count, label }: { count: number; label?: string }) {
  if (count <= 0) return null
  return (
    <span aria-label={label} className="ui-count">
      {count > 99 ? '99+' : count}
    </span>
  )
}

export function Dot({ label = '新' }: { label?: string }) {
  return <span aria-label={label} className="ui-dot" role="img" />
}

/* ---------- Stat ---------- */

export function Stat({ label, value, hint, icon: Icon, tone }: { label: string; value: ReactNode; hint?: ReactNode; icon?: LucideIcon; tone?: Tone }) {
  return (
    <div className={cx('ui-stat', tone && `ui-stat--${tone}`)}>
      <div className="ui-stat__label">
        {Icon ? <Icon aria-hidden size={14} /> : null}
        {label}
      </div>
      <div className="ui-stat__value">{value}</div>
      {hint ? <div className="ui-stat__hint">{hint}</div> : null}
    </div>
  )
}

/* ---------- Tabs（分段选择） ---------- */

export interface TabsProps<T extends string | number> {
  items: readonly { value: T; label: ReactNode; count?: number }[]
  value: T
  onChange: (value: T) => void
  label: string
  className?: string
  variant?: 'pill' | 'underline'
}

export function Tabs<T extends string | number>({ items, value, onChange, label, className, variant = 'pill' }: TabsProps<T>) {
  return (
    <div aria-label={label} className={cx('ui-tabs', `ui-tabs--${variant}`, className)} role="tablist">
      {items.map((item) => (
        <button
          aria-selected={item.value === value}
          className={cx('ui-tabs__item', item.value === value && 'is-active')}
          key={String(item.value)}
          onClick={() => onChange(item.value)}
          role="tab"
          type="button"
        >
          {item.label}
          {item.count ? <span className="ui-tabs__count">{item.count}</span> : null}
        </button>
      ))}
    </div>
  )
}

/* ---------- 键值列表 ---------- */

export function KeyValue({ items }: { items: { label: ReactNode; value: ReactNode }[] }) {
  return (
    <dl className="ui-kv">
      {items.map((item, index) => (
        <div className="ui-kv__row" key={index}>
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  )
}

/* ---------- 进度条 ---------- */

export function Progress({ value, label }: { value: number; label?: string }) {
  const clamped = Math.max(0, Math.min(100, value))
  return (
    <div aria-label={label} aria-valuemax={100} aria-valuemin={0} aria-valuenow={clamped} className="ui-progress" role="progressbar">
      <span style={{ width: `${clamped}%` }} />
    </div>
  )
}
