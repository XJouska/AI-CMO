// 官网 Tab 的纯逻辑：分区编辑字段定义、草稿与表单互转、需确认标记筛选（便于单元测试）。
import { splitList } from '@/lib/validation'
import type { SiteContent, SiteFlag, SiteSection } from './api'

export type FieldKind = 'text' | 'long' | 'list' | 'lines'

export interface SectionField {
  key: string
  kind: FieldKind
  max: number
}

/** 可在应用中直接编辑的分区与字段。证书 / 市场 / 联系方式来自企业档案，只读。 */
export const EDITABLE: Partial<Record<SiteSection, SectionField[]>> = {
  hero: [
    { key: 'headline', kind: 'text', max: 120 },
    { key: 'subheadline', kind: 'long', max: 300 },
    { key: 'cta', kind: 'text', max: 40 },
  ],
  about: [
    { key: 'title', kind: 'text', max: 80 },
    { key: 'body', kind: 'long', max: 3000 },
    { key: 'highlights', kind: 'lines', max: 600 },
  ],
  factory: [
    { key: 'title', kind: 'text', max: 80 },
    { key: 'body', kind: 'long', max: 2000 },
  ],
  seo: [
    { key: 'title', kind: 'text', max: 70 },
    { key: 'description', kind: 'long', max: 200 },
    { key: 'keywords', kind: 'list', max: 600 },
  ],
}

export const READ_ONLY_SECTIONS: SiteSection[] = ['certificates', 'markets', 'contact']
export const AI_SECTIONS: SiteSection[] = ['hero', 'about', 'products', 'factory', 'faq', 'cases', 'seo']
export const SECTION_ORDER: SiteSection[] = ['hero', 'about', 'products', 'factory', 'certificates', 'markets', 'cases', 'faq', 'contact', 'seo']

export function sectionDraft(content: SiteContent, section: SiteSection): Record<string, string> {
  const fields = EDITABLE[section] ?? []
  const data = content[section] as unknown as Record<string, unknown>
  return Object.fromEntries(
    fields.map((f) => {
      const value = data[f.key]
      if (Array.isArray(value)) return [f.key, f.kind === 'lines' ? value.join('\n') : value.join(', ')]
      return [f.key, typeof value === 'string' ? value : '']
    }),
  )
}

/** 表单草稿 → 分区数据（保留表单之外的字段，例如 factory.stats / image_asset_ids）。 */
export function sectionData(content: SiteContent, section: SiteSection, draft: Record<string, string>): Record<string, unknown> {
  const fields = EDITABLE[section] ?? []
  const base = { ...(content[section] as unknown as Record<string, unknown>) }
  for (const field of fields) {
    const text = draft[field.key] ?? ''
    if (field.kind === 'list') base[field.key] = splitList(text)
    else if (field.kind === 'lines') base[field.key] = text.split('\n').map((s) => s.trim()).filter(Boolean)
    else base[field.key] = text.trim()
  }
  return base
}

export function flagsFor(flags: SiteFlag[], section: SiteSection): SiteFlag[] {
  return flags.filter((f) => f.section === section && !f.ack)
}

export function sectionSummary(content: SiteContent, section: SiteSection): string {
  switch (section) {
    case 'hero':
      return content.hero.headline
    case 'about':
      return content.about.body.replace(/<[^>]+>/g, ' ').trim()
    case 'products':
      return content.products.items.map((p) => p.name).join('、')
    case 'factory':
      return content.factory.stats.map((s) => `${s.label} ${s.value}`).join(' · ') || content.factory.body
    case 'certificates':
      return content.certificates.items.join('、')
    case 'markets':
      return content.markets.items.join('、')
    case 'cases':
      return content.cases.items.map((c) => c.title).join('、')
    case 'faq':
      return content.faq.items.map((f) => f.q).join('、')
    case 'contact':
      return [content.contact.email, content.contact.phone].filter(Boolean).join(' · ')
    case 'seo':
      return content.seo.title
    default:
      return ''
  }
}

export function isBusy(task: { status: string }): boolean {
  return task.status === 'running'
}
