import type { ReactNode } from 'react'
import type { AssetDefinition } from '../generated/assets'

export function boolish(value: unknown) {
  return value === true || value === 'true' || value === 'on' || value === 'yes'
}

export function str(value: unknown, fallback = '') {
  if (value === undefined || value === null || value === '' || value === '-1:-1') return fallback
  return String(value)
}

export function contentImageSrc(value: unknown, fallback: string) {
  if (typeof value === 'string' && value.trim()) return value.trim()
  return fallback
}

export function contentImageSrcs(value: unknown, fallback: readonly string[]) {
  if (Array.isArray(value) && value.length && value.every((item) => typeof item === 'string' && item.trim())) {
    return value.map((item) => String(item).trim())
  }
  if (typeof value === 'string' && value.trim()) return [value.trim()]
  return [...fallback]
}

export function isEmptySlot(value: unknown) {
  return value === undefined || value === null || value === '' || value === '-1:-1'
}

export function nodeFileId(nodeId: string) {
  return nodeId.replace(/:/g, '-')
}

export function iconSlug(name: string, nodeId?: string) {
  const base = name
    .replace(/^ICON\//i, '')
    .replace(/^Icon\//, '')
    .trim()
    .replace(/\s+/g, '-')
    .toLowerCase()
  if (!base && nodeId) return nodeFileId(nodeId)
  if (nodeId && (name === 'Icon/Thumbs' || /^Icon\/[ABC]$/.test(name))) {
    return `${base}-${nodeFileId(nodeId)}`
  }
  return base
}

export type PreviewLayout = 'fill' | 'dock-top' | 'dock-bottom' | 'center' | 'stretch-x'

export function previewLayoutFor(asset: AssetDefinition): PreviewLayout {
  const n = asset.name.replace(/[\u200B-\u200D\uFEFF]/g, '')
  if (
    n === 'mask' ||
    n === 'imgViewer' ||
    n === 'videoViewer' ||
    n === 'ipad 模板' ||
    n === '弹窗组件' ||
    n === 'bottomSheet' ||
    n === 'ActionSheet' ||
    n === 'shareSheet' ||
    n === 'FeatureSheet'
  ) {
    return 'fill'
  }
  if (n === 'NavBar 导航栏' || n === '.StatusBar' || n === 'NavBar / Buttons' || n === '.NavBar / Title') {
    return 'dock-top'
  }
  if (n.includes('TabBar') || n === 'Agent Input' || n === 'BrowserToolbar' || n === 'Keyboard') return 'dock-bottom'
  if (
    n === 'List' ||
    n === 'search' ||
    n === '.historyItems' ||
    n.startsWith('Form/') ||
    n === 'Settings/items' ||
    n === 'Settings/fullWidthItem' ||
    n === 'File/items' ||
    n === 'menu/vertical' ||
    n === 'menu/horizontal' ||
    n === 'Notification' ||
    n === 'Snackbar'
  ) {
    return 'stretch-x'
  }
  return 'center'
}

export function defaultButtonLabel(type: string) {
  switch (type) {
    case 'Primary':
      return '主要按钮'
    case 'Secondary':
      return '次要按钮'
    case 'Gray':
      return '灰底按钮'
    case 'Alert':
      return '警示按钮'
    case 'Outline':
      return '描边按钮'
    case 'Text':
      return '文字按钮'
    default:
      return '按钮'
  }
}

export function labelFrom(name: string) {
  return name.replace(/^[._]/, '').split('/').at(-1) || name
}

export function contentOr(value: unknown, fallback: ReactNode) {
  if (value === undefined || value === null || value === '' || value === '-1:-1') return fallback
  return value as ReactNode
}

export function asStringChange(value: unknown) {
  return typeof value === 'function' ? (value as (next: string) => void) : undefined
}

export function variantKey(values: Record<string, unknown>, asset: AssetDefinition) {
  const parts = asset.properties
    .filter((property) => property.type === 'VARIANT')
    .map((property) => `${property.reactProp}=${str(values[property.reactProp], String(property.defaultValue))}`)
  return parts.join(',')
}
