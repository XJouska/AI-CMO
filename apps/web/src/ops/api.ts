// 套餐与用量、通知设置、合规、运营工作台接口。
import { apiFetch, apiRequest } from '@/api/client'

export interface UsageItem {
  kind: string
  label: string
  used: number
  limit: number
}

export interface UsageOut {
  plan: { key: string; name: string; description: string }
  features: string[]
  status: 'active' | 'expired'
  source: string
  starts_at: string | null
  ends_at: string | null
  usage: UsageItem[]
}

export interface PlanOut {
  key: string
  name: string
  description: string
  features: string[]
  limits: Record<string, number>
  price_cents: number
  setup_fee_cents: number
  period: 'month' | 'year'
}

export interface InvoiceOut {
  id: string
  number: string
  amount_cents: number
  status: 'issued' | 'paid' | 'void'
  method: string
  period_start: string | null
  period_end: string | null
  paid_at: string | null
  created_at: string
}

export interface NotificationOut {
  id: string
  kind: string
  title: string
  body: string
  link: string
  read: boolean
  created_at: string
}

export interface PrefsOut {
  groups: { key: string; label: string; email: boolean; wecom: boolean }[]
  wecom_configured: boolean
  email: string
}

export interface CustomerOut {
  id: string
  name_cn: string
  name_en: string
  plan: string
  plan_status: 'active' | 'expired'
  ends_at: string | null
  completeness: number
  site_status: string
  leads_week: number
  pending_review: number
  valid_rate: number | null
  last_active_at: string | null
  operator_joined: boolean
}

export interface AuditOut {
  id: string
  action: string
  actor_user_id: string | null
  company_id: string | null
  target_type: string
  target_id: string
  on_behalf: boolean
  detail: Record<string, unknown>
  created_at: string
}

export interface ReviewItem {
  lead: { id: string; type: string; title: string; summary_cn: string; score: number; market: string }
  company_id: string
  company_name: string
  signals: { source: string; url: string; title: string; snippet: string }[]
}

export const billingApi = {
  usage: () => apiFetch<UsageOut>('/billing/usage'),
  plans: () => apiFetch<PlanOut[]>('/billing/plans'),
  invoices: () => apiFetch<InvoiceOut[]>('/billing/invoices'),
}

export const notificationsApi = {
  list: () => apiFetch<NotificationOut[]>('/notifications'),
  read: (id: string) => apiFetch<void>(`/notifications/${id}/read`, { method: 'POST' }),
  prefs: () => apiFetch<PrefsOut>('/notification-prefs'),
  setPref: (group: string, channel: 'email' | 'wecom', enabled: boolean) =>
    apiFetch<PrefsOut>('/notification-prefs', { method: 'PATCH', body: { group, channel, enabled } }),
  setWecom: (webhook: string) => apiFetch<PrefsOut>('/notification-prefs/wecom', { method: 'PUT', body: { webhook } }),
}

export const complianceApi = {
  /** 下载导出文件（携带认证头，浏览器保存为文件）。 */
  async download(format: 'json' | 'csv') {
    const response = await apiRequest(`/compliance/export?format=${format}`)
    const blob = await response.blob()
    const name = /filename="([^"]+)"/.exec(response.headers.get('content-disposition') ?? '')?.[1] ?? `export.${format}`
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = name
    a.rel = 'noopener'
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  },
  deleteCompany: (companyName: string) =>
    apiFetch<void>('/compliance/delete-company', { method: 'POST', body: { confirm: 'DELETE', company_name: companyName } }),
  requestErasure: (email: string, note: string) => apiFetch<{ status: string }>('/public/data-requests', { method: 'POST', body: { email, note } }),
}

export const opsApi = {
  customers: (q = '') => apiFetch<CustomerOut[]>(`/ops/customers${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  customer: (id: string) =>
    apiFetch<{ customer: CustomerOut; usage: UsageOut; members: { user_id: string; name: string; role: string }[]; recent_audit: AuditOut[] }>(
      `/ops/customers/${id}`,
    ),
  join: (id: string) => apiFetch<CustomerOut>(`/ops/customers/${id}/join`, { method: 'POST' }),
  leave: (id: string) => apiFetch<void>(`/ops/customers/${id}/leave`, { method: 'POST' }),
  activate: (id: string, body: { plan_key: string; ends_at?: string | null; note?: string; invoice_amount_cents?: number | null }) =>
    apiFetch<unknown>(`/ops/companies/${id}/subscription`, { method: 'POST', body }),
  reviewQueue: () => apiFetch<ReviewItem[]>('/ops/review-queue'),
  review: (leadId: string, body: { decision: 'approved' | 'rejected'; summary_cn?: string }) =>
    apiFetch<unknown>(`/ops/leads/${leadId}/review`, { method: 'POST', body }),
  audit: (params = '') => apiFetch<AuditOut[]>(`/ops/audit-logs${params}`),
  sources: () =>
    apiFetch<{ source_key: string; enabled: boolean; requests: number; success_rate: number | null; avg_ms: number; blocked: number; leads: number; valid_rate: number | null }[]>(
      '/ops/sources',
    ),
  toggleSource: (key: string, enabled: boolean) => apiFetch<unknown>(`/ops/sources/${key}`, { method: 'PATCH', body: { enabled } }),
  costs: (days = 30) =>
    apiFetch<{ days: number; totals: Record<string, number>; cost_micros: number; companies: { company_id: string; name: string; usage: Record<string, number>; cost_micros: number }[] }>(
      `/ops/costs?days=${days}`,
    ),
  evals: () =>
    apiFetch<{ datasets: string[]; runs: { id: string; dataset: string; mode: string; status: string; metrics: Record<string, number>; error: string; created_at: string }[] }>(
      '/ops/evals',
    ),
  runEval: (dataset: string) => apiFetch<{ id: string }>('/ops/evals', { method: 'POST', body: { dataset } }),
  dataRequests: () =>
    apiFetch<{ id: string; kind: string; email: string; note: string; status: string; result: Record<string, number>; created_at: string }[]>('/ops/data-requests'),
  handleDataRequest: (id: string, decision: 'done' | 'rejected') => apiFetch<unknown>(`/ops/data-requests/${id}`, { method: 'POST', body: { decision } }),
}

export function yuan(cents: number): string {
  return `¥${(cents / 100).toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`
}

export function usageText(item: UsageItem): string {
  if (item.limit < 0) return `${item.used.toLocaleString('zh-CN')} / 不限`
  if (item.limit === 0) return '不含'
  return `${item.used.toLocaleString('zh-CN')} / ${item.limit.toLocaleString('zh-CN')}`
}

export function pct(value: number | null): string {
  return value === null ? '—' : `${Math.round(value * 100)}%`
}
