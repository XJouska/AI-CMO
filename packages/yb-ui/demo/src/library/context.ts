import type { ReactNode } from 'react'
import type { AssetDefinition } from '../generated/assets'

export interface RenderCtx {
  asset: AssetDefinition
  values: Record<string, unknown>
  children?: ReactNode
  className: string
  onAction?: (action: string) => void
  renderSlot: (value: unknown, fallback?: ReactNode) => ReactNode
  renderNamed: (name: string, values?: Record<string, unknown>, children?: ReactNode) => ReactNode
  v: (key: string) => unknown
}
