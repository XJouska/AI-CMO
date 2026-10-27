import type { ReactNode } from 'react'

export interface CommonAssetProps {
  className?: string
  children?: ReactNode
  label?: string
  decorative?: boolean
  maxLength?: number
  onAction?: (action: string) => void
  onChange?: (value: string) => void
  placeholder?: string
  value?: string
  subtitle?: unknown
  subtitle2?: unknown
  trailing?: string
  trailingKind?: 'more' | 'chevron' | 'none' | 'avatar'
  avatarKind?: 'default' | 'camera' | 'album'
  items?: unknown
  cancelLabel?: string
  showIcon?: boolean
  illus?: 'networkError' | 'noContent' | 'placeholder'
  descText?: string
  buttonLabel?: string
  bodyText?: string
  bodyType?: 'singleText' | 'multiText' | 'overflowText' | 'middleCheckbox' | 'leftCheckbox'
  secondaryLabel?: string
  primaryLabel?: string
  primaryType?: string
  imageSrc?: string
  imageSrcs?: string[]
  /** 现场 Agent Input 右按钮组合覆盖（如 'Send Only'），仅内容字段，不改外观 */
  rightType?: string
  /** 现场文件卡内容字段：文件类型（如 'PDF'） */
  file?: string
  /** 现场文件卡内容字段：文件状态 */
  state?: string
  title?: string | boolean
  navbarType?: 'default' | 'tabCard'
  navbarPosition?: 'left' | 'middle'
  navbarDivider?: boolean
  navbarContent?: boolean
  buttonType?: '1Btn' | '2BtnHorizantal' | '2BtnVertical'
  description?: boolean
  leftIcon?: boolean
  rightIcon?: boolean
  leftNavSlot?: ReactNode
  rightNavSlot?: ReactNode
  leftNavIcon?: ReactNode
  rightNavIcon?: ReactNode
  leftIconName?: string
  rightIconName?: string
  leftIconAction?: string
  rightIconAction?: string
  leftIconLabel?: string
  rightIconLabel?: string
  textLabel?: string
}
