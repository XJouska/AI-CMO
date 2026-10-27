// 商机接口。
import { apiFetch } from '@/api/client'

export type LeadType = 'tender' | 'rfq' | 'buyer_intent' | 'prospect' | 'site_inquiry'

export interface LeadOut {
  id: string
  type: LeadType
  title: string
  summary_cn: string
  reasons: string[]
  suggested_action: string
  products_matched: string[]
  market: string
  score: number
  score_detail: { key: string; label: string; weight: number; score: number }[]
  confidence: 'high' | 'medium' | 'low'
  deadline: string | null
  source_url: string
  source_domain: string
  status: string
  review_status: string
  is_new: boolean
  created_at: string
  buyer: { name: string; domain: string; country: string; industry: string; size_hint: string; public_contacts: { emails?: string[]; phones?: string[]; source?: string } } | null
  signal_count: number
}

export interface LeadPage {
  items: LeadOut[]
  total: number
  new_count: number
  today_count: number
}

export interface RunOut {
  id: string
  status: 'queued' | 'running' | 'done' | 'failed'
  trigger: string
  stats: Record<string, unknown>
  error: string
  created_at: string
  finished_at: string | null
}

export interface WatchOut {
  id: string
  name: string
  product_ids: string[]
  markets: string[]
  keywords_en: string[]
  negative_keywords: string[]
  source_keys: string[]
  frequency: 'daily' | 'weekly'
  is_active: boolean
  status: 'draft' | 'active'
  last_run_at: string | null
  next_run_at: string | null
  last_run: RunOut | null
}

export interface LeadFilters {
  type?: LeadType
  market?: string
  min_score?: number
}

export function leadsQuery(filters: LeadFilters, offset: number, limit = 20): string {
  const params = new URLSearchParams()
  if (filters.type) params.set('type', filters.type)
  if (filters.market) params.set('market', filters.market)
  if (filters.min_score) params.set('min_score', String(filters.min_score))
  params.set('offset', String(offset))
  params.set('limit', String(limit))
  return `/leads?${params.toString()}`
}

export const leadsApi = {
  list: (filters: LeadFilters, offset = 0) => apiFetch<LeadPage>(leadsQuery(filters, offset)),
  get: (id: string) => apiFetch<LeadOut>(`/leads/${id}`),
  feedback: (id: string, verdict: 'useful' | 'irrelevant' | 'duplicate' | 'fake') =>
    apiFetch<void>(`/leads/${id}/feedback`, { method: 'POST', body: { verdict } }),
  watches: () => apiFetch<WatchOut[]>('/watches'),
  fromProfile: () => apiFetch<WatchOut>('/watches/from-profile', { method: 'POST' }),
  updateWatch: (id: string, body: Partial<Pick<WatchOut, 'name' | 'markets' | 'keywords_en' | 'negative_keywords' | 'frequency' | 'is_active'>>) =>
    apiFetch<WatchOut>(`/watches/${id}`, { method: 'PATCH', body }),
  runWatch: (id: string) => apiFetch<RunOut>(`/watches/${id}/run`, { method: 'POST' }),
}
