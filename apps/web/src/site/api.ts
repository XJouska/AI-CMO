// 官网接口。
import { apiFetch } from '@/api/client'

export type SiteSection = 'hero' | 'about' | 'products' | 'factory' | 'certificates' | 'markets' | 'cases' | 'faq' | 'contact' | 'seo'
export type TemplateKey = 'industrial' | 'building' | 'consumer'

export interface TaskStep {
  key: string
  label: string
  status: 'pending' | 'running' | 'done' | 'failed'
}

export interface SiteOut {
  id: string
  status: 'draft' | 'published' | 'suspended'
  template_key: TemplateKey
  url: string
  subdomain_host: string
  custom_domain: string | null
  domain_verified: boolean
  domain_token: string
  draft_version_id: string | null
  published_version_id: string | null
  has_unpublished_changes: boolean
  published_at: string | null
  task: { kind: string; status: 'idle' | 'running' | 'failed'; progress: TaskStep[]; error: string }
  health_score: number | null
  unresolved_flags: number
  inquiry_count: number
  new_inquiry_count: number
}

export interface SiteFlag {
  section: string
  field: string
  text: string
  reason: string
  ack?: boolean
}

export interface SiteVersionOut {
  id: string
  content: SiteContent
  flags: SiteFlag[]
  note: string
  created_at: string
  is_published: boolean
  is_draft: boolean
}

export interface SiteContent {
  company_name: string
  hero: { headline: string; subheadline: string; cta: string }
  about: { title: string; body: string; highlights: string[] }
  products: { title: string; items: { product_id: string; name: string; summary: string; image_asset_id: string; keywords: string[] }[] }
  factory: { title: string; body: string; stats: { label: string; value: string }[]; image_asset_ids: string[] }
  certificates: { title: string; items: string[]; image_asset_ids: string[] }
  markets: { title: string; items: string[] }
  cases: { title: string; items: { title: string; body: string }[] }
  faq: { title: string; items: { q: string; a: string }[] }
  contact: { title: string; email: string; phone: string; whatsapp: string; address: string }
  seo: { title: string; description: string; keywords: string[] }
}

export interface InquiryOut {
  id: string
  name: string
  email: string
  company_name: string
  country: string
  product_ref: string
  message: string
  status: 'new' | 'read' | 'spam'
  created_at: string
}

export interface HealthOut {
  score: number
  issues: { key: string; severity: 'high' | 'medium' | 'low'; title: string; fix: string; section: string }[]
  created_at: string
}

export const siteApi = {
  site: () => apiFetch<SiteOut>('/site'),
  generate: (template?: TemplateKey) => apiFetch<SiteOut>('/site/generate', { method: 'POST', body: template ? { template } : {} }),
  setTemplate: (template: TemplateKey) => apiFetch<SiteOut>('/site', { method: 'PATCH', body: { template } }),
  draft: () => apiFetch<SiteVersionOut>('/site/draft'),
  saveSection: (section: SiteSection, data: unknown) => apiFetch<SiteVersionOut>(`/site/sections/${section}`, { method: 'PUT', body: { data } }),
  rewrite: (section: SiteSection, instruction: string) =>
    apiFetch<SiteOut>(`/site/sections/${section}/rewrite`, { method: 'POST', body: { instruction } }),
  ackFlag: (flag: SiteFlag) => apiFetch<SiteVersionOut>('/site/flags/ack', { method: 'POST', body: { section: flag.section, field: flag.field, text: flag.text } }),
  versions: () => apiFetch<SiteVersionOut[]>('/site/versions'),
  restore: (id: string) => apiFetch<SiteVersionOut>(`/site/versions/${id}/restore`, { method: 'POST' }),
  publish: () => apiFetch<SiteOut>('/site/publish', { method: 'POST' }),
  previewUrl: () => apiFetch<{ url: string; expires_in: number }>('/site/preview-url'),
  healthCheck: () => apiFetch<HealthOut>('/site/health-check', { method: 'POST' }),
  health: () => apiFetch<HealthOut>('/site/health'),
  setDomain: (domain: string) => apiFetch<SiteOut>('/site/domain', { method: 'PUT', body: { domain } }),
  verifyDomain: () => apiFetch<SiteOut>('/site/domain/verify', { method: 'POST' }),
  removeDomain: () => apiFetch<SiteOut>('/site/domain', { method: 'DELETE' }),
  inquiries: (limit = 50) => apiFetch<InquiryOut[]>(`/site/inquiries?limit=${limit}`),
  inquiry: (id: string) => apiFetch<InquiryOut>(`/site/inquiries/${id}`),
  markInquiry: (id: string, status: InquiryOut['status']) => apiFetch<InquiryOut>(`/site/inquiries/${id}`, { method: 'PATCH', body: { status } }),
}
