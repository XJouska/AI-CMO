import { Loader2, type LucideIcon } from 'lucide-react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cx } from './cx'

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger' | 'danger-ghost' | 'link'
export type ButtonSize = 'sm' | 'md' | 'lg'

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  variant?: ButtonVariant
  size?: ButtonSize
  block?: boolean
  loading?: boolean
  icon?: LucideIcon
  iconRight?: LucideIcon
  children?: ReactNode
}

const ICON_SIZE: Record<ButtonSize, number> = { sm: 14, md: 16, lg: 18 }

export function Button({
  variant = 'secondary',
  size = 'md',
  block,
  loading,
  icon: Icon,
  iconRight: IconRight,
  className,
  disabled,
  type = 'button',
  children,
  ...rest
}: ButtonProps) {
  const iconSize = ICON_SIZE[size]
  return (
    <button
      {...rest}
      aria-busy={loading || undefined}
      className={cx('ui-btn', `ui-btn--${variant}`, `ui-btn--${size}`, block && 'ui-btn--block', className)}
      disabled={disabled || loading}
      type={type}
    >
      {loading ? <Loader2 aria-hidden className="ui-spin" size={iconSize} /> : Icon ? <Icon aria-hidden size={iconSize} /> : null}
      {children !== undefined && children !== null && children !== '' ? <span className="ui-btn__label">{children}</span> : null}
      {IconRight ? <IconRight aria-hidden size={iconSize} /> : null}
    </button>
  )
}

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  icon: LucideIcon
  label: string
  size?: ButtonSize
  variant?: 'ghost' | 'outline' | 'primary'
  active?: boolean
}

export function IconButton({ icon: Icon, label, size = 'md', variant = 'ghost', active, className, type = 'button', ...rest }: IconButtonProps) {
  return (
    <button
      {...rest}
      aria-label={label}
      aria-pressed={active === undefined ? undefined : active}
      className={cx('ui-icon-btn', `ui-icon-btn--${variant}`, `ui-icon-btn--${size}`, active && 'is-active', className)}
      title={label}
      type={type}
    >
      <Icon aria-hidden size={size === 'sm' ? 16 : size === 'lg' ? 20 : 18} />
    </button>
  )
}
