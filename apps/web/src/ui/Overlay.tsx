// 浮层：Modal（居中对话框）、Drawer（侧边 / 底部抽屉）、Menu（选项菜单）、ConfirmDialog。
// 全部通过 portal 挂到 document.body；Esc 关闭；打开时锁定页面滚动，焦点移入浮层并在关闭后归还。
import { X } from 'lucide-react'
import { useEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Button } from './Button'
import { cx } from './cx'

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

let openCount = 0

function useOverlay(open: boolean, onClose: () => void) {
  const panelRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    if (!open) return
    const previous = document.activeElement as HTMLElement | null
    openCount += 1
    document.body.style.overflow = 'hidden'
    const panel = panelRef.current
    const first = panel?.querySelector<HTMLElement>('[data-autofocus]') ?? panel?.querySelector<HTMLElement>(FOCUSABLE)
    ;(first ?? panel)?.focus({ preventScroll: true })

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        closeRef.current()
        return
      }
      if (event.key !== 'Tab' || !panel) return
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE))
      if (!items.length) return
      const head = items[0]
      const tail = items[items.length - 1]
      if (event.shiftKey && document.activeElement === head) {
        event.preventDefault()
        tail.focus()
      } else if (!event.shiftKey && document.activeElement === tail) {
        event.preventDefault()
        head.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      openCount -= 1
      if (openCount <= 0) {
        openCount = 0
        document.body.style.overflow = ''
      }
      previous?.focus?.({ preventScroll: true })
    }
  }, [open])

  return panelRef
}

export interface ModalProps {
  open: boolean
  title: ReactNode
  description?: ReactNode
  onClose: () => void
  children?: ReactNode
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg'
  /** 用于 aria-label（title 不是纯文本时） */
  label?: string
}

export function Modal({ open, title, description, onClose, children, footer, size = 'md', label }: ModalProps) {
  const panelRef = useOverlay(open, onClose)
  const titleId = useId()
  if (!open) return null
  return createPortal(
    <div className="ui-overlay ui-overlay--center">
      <div aria-hidden className="ui-overlay__mask" onClick={onClose} />
      <div
        aria-label={label}
        aria-labelledby={label ? undefined : titleId}
        aria-modal="true"
        className={cx('ui-modal', `ui-modal--${size}`)}
        ref={panelRef}
        role="dialog"
        tabIndex={-1}
      >
        <div className="ui-modal__header">
          <div>
            <h2 className="ui-modal__title" id={titleId}>
              {title}
            </h2>
            {description ? <p className="ui-modal__desc">{description}</p> : null}
          </div>
          <button aria-label="关闭" className="ui-modal__close" onClick={onClose} type="button">
            <X aria-hidden size={18} />
          </button>
        </div>
        {children ? <div className="ui-modal__body">{children}</div> : null}
        {footer ? <div className="ui-modal__footer">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  )
}

export interface ConfirmDialogProps {
  open: boolean
  title: string
  body?: ReactNode
  confirmLabel: string
  cancelLabel: string
  danger?: boolean
  loading?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({ open, title, body, confirmLabel, cancelLabel, danger, loading, onConfirm, onCancel }: ConfirmDialogProps) {
  return (
    <Modal
      footer={
        <>
          <Button onClick={onCancel} variant="ghost">
            {cancelLabel}
          </Button>
          <Button data-autofocus loading={loading} onClick={onConfirm} variant={danger ? 'danger' : 'primary'}>
            {confirmLabel}
          </Button>
        </>
      }
      onClose={onCancel}
      open={open}
      size="sm"
      title={title}
    >
      {body ? <div className="ui-modal__text">{body}</div> : null}
    </Modal>
  )
}

export interface DrawerProps {
  open: boolean
  title: ReactNode
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  side?: 'right' | 'left'
  description?: ReactNode
  label?: string
  className?: string
}

/** 侧边抽屉：桌面从右侧（或左侧）滑出，手机从底部弹出。 */
export function Drawer({ open, title, onClose, children, footer, side = 'right', description, label, className }: DrawerProps) {
  const panelRef = useOverlay(open, onClose)
  const titleId = useId()
  if (!open) return null
  return createPortal(
    <div className={cx('ui-overlay', `ui-overlay--${side}`)}>
      <div aria-hidden className="ui-overlay__mask" onClick={onClose} />
      <div
        aria-label={label}
        aria-labelledby={label ? undefined : titleId}
        aria-modal="true"
        className={cx('ui-drawer', `ui-drawer--${side}`, className)}
        ref={panelRef}
        role="dialog"
        tabIndex={-1}
      >
        <div className="ui-drawer__header">
          <div>
            <h2 className="ui-modal__title" id={titleId}>
              {title}
            </h2>
            {description ? <p className="ui-modal__desc">{description}</p> : null}
          </div>
          <button aria-label="关闭" className="ui-modal__close" onClick={onClose} type="button">
            <X aria-hidden size={18} />
          </button>
        </div>
        <div className="ui-drawer__body">{children}</div>
        {footer ? <div className="ui-drawer__footer">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  )
}

export interface FormModalProps {
  open: boolean
  title: string
  description?: ReactNode
  primaryLabel: string
  secondaryLabel: string
  onPrimary: () => void
  /** 次要按钮；不传时等同关闭 */
  onSecondary?: () => void
  onClose: () => void
  primaryDisabled?: boolean
  loading?: boolean
  danger?: boolean
  children: ReactNode
}

/** 带「次要 / 主要」两个按钮的表单对话框。 */
export function FormModal({ open, title, description, primaryLabel, secondaryLabel, onPrimary, onSecondary, onClose, primaryDisabled, loading, danger, children }: FormModalProps) {
  return (
    <Modal
      description={description}
      footer={
        <>
          <Button onClick={onSecondary ?? onClose} variant="ghost">
            {secondaryLabel}
          </Button>
          <Button disabled={primaryDisabled} loading={loading} onClick={onPrimary} variant={danger ? 'danger' : 'primary'}>
            {primaryLabel}
          </Button>
        </>
      }
      onClose={onClose}
      open={open}
      title={title}
    >
      <form
        className="ui-form-stack"
        onSubmit={(event) => {
          event.preventDefault()
          if (!primaryDisabled) onPrimary()
        }}
      >
        {children}
        <button aria-hidden className="sr-only" tabIndex={-1} type="submit">
          {primaryLabel}
        </button>
      </form>
    </Modal>
  )
}

export interface ChoiceMenuProps {
  open: boolean
  title: string
  description?: string
  items: readonly { label: string; danger?: boolean; current?: boolean }[]
  cancelLabel: string
  onSelect: (index: number) => void
  onCancel: () => void
}

/** 选项菜单（例如「重命名 / 删除」、切换企业）。 */
export function ChoiceMenu({ open, title, description, items, cancelLabel, onSelect, onCancel }: ChoiceMenuProps) {
  return (
    <Modal
      description={description}
      footer={
        <Button onClick={onCancel} variant="ghost">
          {cancelLabel}
        </Button>
      }
      onClose={onCancel}
      open={open}
      size="sm"
      title={title}
    >
      <div className="ui-menu">
        {items.map((item, index) => (
          <button
            aria-current={item.current || undefined}
            className={cx('ui-menu__item', item.danger && 'is-danger', item.current && 'is-current')}
            key={`${item.label}-${index}`}
            onClick={() => onSelect(index)}
            type="button"
          >
            {item.label}
          </button>
        ))}
      </div>
    </Modal>
  )
}
