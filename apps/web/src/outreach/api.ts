// 触达与跟进接口：跟进阶段、跟进记录、开发信、发信邮箱、屏蔽名单、待跟进、周报。
import { apiFetch } from '@/api/client'

export type Stage = 'new' | 'viewed' | 'contacted' | 'replied' | 'inquiry' | 'quoted' | 'sampling' | 'won' | 'lost' | 'invalid'
export type Tone = 'concise' | 'professional' | 'warm'
export const TONES: Tone[] = ['concise', 'professional', 'warm']
export const CLOSED_STAGES: Stage[] = ['lost', 'invalid']

export interface PipelineOut {
  lead_id: string
  stage: Stage
  stage_label: string
  allowed_next: Stage[]
  next_action: string
  next_action_at: string | null
  overdue: boolean
  lost_reason: string
  deal_value: number | null
  currency: string
}

export interface ActivityOut {
  id: string
  kind: 'note' | 'email_draft' | 'email_sent' | 'reply' | 'call' | 'stage_change'
  content: Record<string, unknown>
  user_id: string | null
  created_at: string
}

export interface FollowUpOut {
  pipeline: PipelineOut
  activities: ActivityOut[]
  stages: Record<Stage, string>
  lost_reasons: Record<string, string>
}

export interface DraftOut {
  id: string
  lead_id: string
  tone: Tone
  language: string
  to_email: string
  subject: string
  body: string
  version: number
  status: 'draft' | 'approved' | 'sent'
  flags: { text: string; reason: string }[]
  word_count: number
  mailto: string
  created_at: string
  sent_at: string | null
}

export interface MailAccountOut {
  id: string
  provider: string
  from_address: string
  from_name: string
  smtp_host: string
  smtp_port: number
  username: string
  daily_limit: number
  sent_today: number
  verified: boolean
  last_error: string
  dns: { spf?: boolean; dmarc?: boolean; hints?: string[] }
}

export interface MailAccountIn {
  from_address: string
  from_name: string
  smtp_host: string
  smtp_port: 465 | 587
  username: string
  password: string
  daily_limit: number
}

export interface DueItem {
  lead_id: string
  title: string
  type: string
  score: number
  pipeline: PipelineOut
}

export interface ReportOut {
  id: string
  week_start: string
  stats: Record<string, unknown>
  markdown: string
  created_at: string
}

export const outreachApi = {
  followUp: (leadId: string) => apiFetch<FollowUpOut>(`/leads/${leadId}/follow-up`),
  setStage: (leadId: string, body: { stage: Stage; note?: string; lost_reason?: string; deal_value?: number }) =>
    apiFetch<PipelineOut>(`/leads/${leadId}/stage`, { method: 'POST', body }),
  setNextAction: (leadId: string, body: { next_action: string; next_action_at: string | null }) =>
    apiFetch<PipelineOut>(`/leads/${leadId}/next-action`, { method: 'PUT', body }),
  addActivity: (leadId: string, body: { kind: 'note' | 'reply' | 'call'; text: string }) =>
    apiFetch<ActivityOut>(`/leads/${leadId}/activities`, { method: 'POST', body }),
  due: () => apiFetch<DueItem[]>('/follow-ups/due'),
  drafts: (leadId: string) => apiFetch<DraftOut[]>(`/leads/${leadId}/drafts`),
  newDraft: (leadId: string, tone: Tone) => apiFetch<DraftOut>(`/leads/${leadId}/drafts`, { method: 'POST', body: { tone } }),
  revise: (draftId: string, instruction: string) => apiFetch<DraftOut>(`/drafts/${draftId}/revise`, { method: 'POST', body: { instruction } }),
  editDraft: (draftId: string, body: { to_email?: string; subject?: string; body?: string }) =>
    apiFetch<DraftOut>(`/drafts/${draftId}`, { method: 'PATCH', body }),
  markSent: (draftId: string, method: 'copy' | 'mailto') => apiFetch<DraftOut>(`/drafts/${draftId}/mark-sent`, { method: 'POST', body: { method } }),
  send: (draftId: string, body: { mail_account_id: string; confirm_to: string; confirm_subject: string }) =>
    apiFetch<{ draft: DraftOut; pipeline: PipelineOut; remaining_today: number }>(`/drafts/${draftId}/send`, { method: 'POST', body }),
  mailAccounts: () => apiFetch<MailAccountOut[]>('/mail-accounts'),
  createMailAccount: (body: MailAccountIn) => apiFetch<MailAccountOut>('/mail-accounts', { method: 'POST', body }),
  updateMailAccount: (id: string, body: { from_name?: string; daily_limit?: number }) => apiFetch<MailAccountOut>(`/mail-accounts/${id}`, { method: 'PATCH', body }),
  deleteMailAccount: (id: string) => apiFetch<void>(`/mail-accounts/${id}`, { method: 'DELETE' }),
  suppressions: () => apiFetch<{ email: string; reason: string; created_at: string }[]>('/email-suppressions'),
  suppress: (email: string) => apiFetch<void>('/email-suppressions', { method: 'POST', body: { email } }),
  reports: () => apiFetch<ReportOut[]>('/reports/weekly'),
  report: (id: string) => apiFetch<ReportOut>(`/reports/weekly/${id}`),
  preview: () => apiFetch<ReportOut>('/reports/weekly-preview'),
}

/** 本地时间 → 「MM-DD HH:mm」。 */
export function shortTime(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 跟进记录的一行描述（纯文本，不渲染 HTML）。 */
export function describeActivity(a: ActivityOut, stages: Record<string, string>, lostReasons: Record<string, string>): { title: string; detail: string } {
  const c = a.content
  const s = (v: unknown) => (typeof v === 'string' ? v : '')
  switch (a.kind) {
    case 'stage_change': {
      const reason = s(c.lost_reason) ? `（${lostReasons[s(c.lost_reason)] ?? s(c.lost_reason)}）` : ''
      return { title: `${stages[s(c.from)] ?? s(c.from)} → ${stages[s(c.to)] ?? s(c.to)}${reason}`, detail: s(c.note) }
    }
    case 'email_sent':
      return { title: `已发送开发信：${s(c.subject)}`, detail: s(c.to) }
    case 'email_draft':
      return { title: `生成开发信（第 ${Number(c.version ?? 1)} 版）`, detail: '' }
    case 'reply':
      return { title: '对方回复', detail: s(c.text) }
    case 'call':
      return { title: '电话 / 会议', detail: s(c.text) }
    default:
      return { title: '笔记', detail: s(c.text) }
  }
}

/** datetime-local 输入值 → ISO（带时区）；空值返回 null。 */
export function localInputToIso(value: string): string | null {
  if (!value) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}
