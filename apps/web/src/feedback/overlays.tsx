// 浮层：正式 Dialog / ActionSheet / BottomSheet 挂载到 HostCanvas 的 ModalLayer 上。
// 只负责挂载与回调转换，不改变组件外观。
import type { ReactNode } from 'react'
import { ActionSheet, BottomSheet, Dialog, Mask } from '@yb/generated/components'
import { ModalLayer } from '@yb/library/DeviceOverlays'

interface ConfirmDialogProps {
  open: boolean
  title: string
  body?: string
  confirmLabel: string
  cancelLabel: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({ open, title, body, confirmLabel, cancelLabel, danger, onConfirm, onCancel }: ConfirmDialogProps) {
  if (!open) return null
  return (
    <ModalLayer kind="dialog" label={title} mask={<Mask onAction={onCancel} type="popup mask" />} onClose={onCancel}>
      <Dialog
        bodySwitch={Boolean(body)}
        bodyText={body}
        onAction={(action) => {
          if (action === 'dialog-confirm') onConfirm()
          if (action === 'dialog-cancel') onCancel()
        }}
        primaryLabel={confirmLabel}
        primaryType={danger ? 'Alert' : 'Primary'}
        secondaryLabel={cancelLabel}
        titleSwitch
      >
        {title}
      </Dialog>
    </ModalLayer>
  )
}

interface ChoiceSheetProps {
  open: boolean
  label: string
  description?: string
  items: string[]
  cancelLabel: string
  onSelect: (index: number) => void
  onCancel: () => void
}

export function ChoiceSheet({ open, label, description, items, cancelLabel, onSelect, onCancel }: ChoiceSheetProps) {
  if (!open) return null
  return (
    <ModalLayer kind="sheet" label={label} mask={<Mask onAction={onCancel} type="popup mask" />} onClose={onCancel}>
      <ActionSheet
        cancelLabel={cancelLabel}
        desc={description ? <span>{description}</span> : undefined}
        items={items}
        onAction={(action) => {
          if (action === 'cancel') onCancel()
          else if (action.startsWith('item:')) onSelect(Number(action.slice(5)))
        }}
        showDesc={Boolean(description)}
        showIcon={false}
      />
    </ModalLayer>
  )
}

interface SheetProps {
  open: boolean
  title: string
  description?: string
  primaryLabel: string
  secondaryLabel: string
  onPrimary: () => void
  onClose: () => void
  children: ReactNode
}

/** 正式 BottomSheet：标题 + 内容 + 「取消 / 确认」两个按钮。 */
export function FormSheet({ open, title, description, primaryLabel, secondaryLabel, onPrimary, onClose, children }: SheetProps) {
  if (!open) return null
  return (
    <ModalLayer kind="sheet" label={title} mask={<Mask onAction={onClose} type="popup mask" />} onClose={onClose}>
      <div
        className="sheet-actions"
        onClickCapture={(event) => {
          // 正式 BottomSheet 的按钮组没有对外回调：按按钮所在位置区分次要 / 主要按钮
          const button = (event.target as HTMLElement).closest('.yb-sheet-buttons .yb-button')
          if (!button) return
          const buttons = Array.from(button.parentElement?.querySelectorAll('.yb-button') ?? [])
          if (buttons.indexOf(button) === buttons.length - 1) onPrimary()
          else onClose()
        }}
      >
        <BottomSheet
          buttonType="2BtnHorizantal"
          content={children}
          descText={description}
          description={Boolean(description)}
          leftIcon={false}
          navbarDivider={false}
          primaryLabel={primaryLabel}
          rightIcon={false}
          secondaryLabel={secondaryLabel}
          title={title}
        />
      </div>
    </ModalLayer>
  )
}
