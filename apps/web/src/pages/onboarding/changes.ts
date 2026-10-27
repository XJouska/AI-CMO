// 档案变更的显示与编辑转换（纯函数，便于单元测试）。所有值按纯文本处理。
import type { ExtractionChange } from '@/api/endpoints'
import { splitList } from '@/lib/validation'

const LIST_FIELDS = new Set(['export_markets', 'main_customers_public', 'certifications'])

export function describeValue(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (Array.isArray(value)) return value.map((item) => String(item)).join('、')
  if (typeof value === 'object') {
    const product = value as { name_en?: unknown; name_cn?: unknown; category?: unknown }
    return [product.name_en, product.name_cn, product.category].filter((part) => typeof part === 'string' && part).join(' · ')
  }
  return String(value)
}

export function editableText(change: ExtractionChange, value: unknown): string {
  if (change.group === 'product' && value && typeof value === 'object') {
    return String((value as { name_en?: unknown }).name_en ?? '')
  }
  if (Array.isArray(value)) return value.join(', ')
  return value === null || value === undefined ? '' : String(value)
}

/** 把编辑后的文本转换回该字段的值类型。产品只允许修改英文名，其余字段保留。 */
export function parseEdited(change: ExtractionChange, text: string): unknown {
  const trimmed = text.trim()
  if (change.group === 'product') {
    return { ...(change.value as Record<string, unknown>), name_en: trimmed }
  }
  if (LIST_FIELDS.has(change.field)) return splitList(trimmed)
  if (change.field === 'founded_year') return /^\d{4}$/.test(trimmed) ? Number(trimmed) : change.value
  return trimmed
}
