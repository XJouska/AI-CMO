// 代运营服务接口：客户进度、开通向导、修改意见、确认上线；运营待办与客户工作台；买家联系话术包。
import { apiFetch } from '@/api/client'

export type StageKey = 'materials' | 'building' | 'review' | 'live'
export type BuyersState = 'none' | 'preparing' | 'searching' | 'found' | 'failed'
export type MaterialKind = 'factory_photo' | 'product_photo' | 'catalog' | 'certificate' | 'business_card' | 'logo'
export type StyleChoice = 'heavy' | 'precision' | 'building' | 'consumer' | 'heritage' | 'tech' | 'own'
export type Layout = Exclude<StyleChoice, 'own'>

export interface MaterialCategory {
  key: MaterialKind
  label: string
  /** 建议上传（网站更好看）；所有类别都不是必需的 */
  recommended: boolean
  images_only: boolean
}

export interface Overview {
  stage: StageKey | 'start'
  stages: { key: StageKey; label: string; state: 'done' | 'current' | 'todo' }[]
  next: { title: string; body: string; action: string; link: string }
  buyers: { state: BuyersState; found: number; products: string[]; markets: string[]; business: string; target_markets: string }
  materials: Partial<Record<MaterialKind, number>>
  missing: MaterialKind[]
  categories: MaterialCategory[]
  style_choice: StyleChoice | ''
  site_url: string
  week: { buyers_week: number; buyers_total: number; inquiries_week: number }
  build_hours: number
  submitted: boolean
  /** 客户提的修改意见还在处理中 */
  revising: boolean
}

export interface ServiceTask {
  id: string
  company_id: string
  company_name: string
  kind: 'organize' | 'build_site' | 'revise_site' | 'setup_buyers'
  kind_label: string
  status: 'open' | 'doing' | 'done' | 'cancelled'
  note: string
  asset_ids: string[]
  created_at: string
  done_at: string | null
}

export interface SiteStyle {
  layout: Layout
  palette: { primary: string; accent: string }
  font: 'sans' | 'serif' | 'rounded'
  radius: 'sharp' | 'small' | 'round'
  image: 'plain' | 'framed' | 'duotone'
}

export interface Workbench {
  business: string
  target_markets: string
  quickstart_status: '' | 'running' | 'done' | 'failed'
  quickstart_error: string
  company_id: string
  name_cn: string
  name_en: string
  stage: StageKey | 'start'
  waiting_on: 'customer' | 'team' | 'none'
  style_choice: StyleChoice | ''
  links: string[]
  note: string
  materials: Partial<Record<MaterialKind, number>>
  missing: MaterialKind[]
  categories: MaterialCategory[]
  products: number
  completeness: number
  site: { status: string; has_draft: boolean; task_status: string; task_kind: string; task_error: string; style: Partial<SiteStyle> } | null
  watch_active: boolean
  leads_pending: number
  leads_approved: number
  tasks: ServiceTask[]
  steps: { key: string; label: string; done: boolean }[]
}

export interface StyleCatalog {
  layouts: { key: Layout; label: string; desc: string; primary: string; accent: string }[]
  fonts: SiteStyle['font'][]
  radii: SiteStyle['radius'][]
  images: SiteStyle['image'][]
}

export type Channel = 'email' | 'whatsapp' | 'phone' | 'linkedin' | 'form'
export type ContactState = 'none' | 'contacted' | 'replied' | 'not_interested'

export interface KitItem {
  id: string
  channel: Channel
  channel_label: string
  target: string
  subject: string
  body: string
  subject_zh: string
  body_zh: string
  open_link: string
  flags: { text: string; reason: string }[]
  created_at: string
}

export interface ContactKit {
  lead_id: string
  channels: Channel[]
  items: KitItem[]
  contact_state: ContactState
}

export const serviceApi = {
  overview: () => apiFetch<Overview>('/service/overview'),
  submitBusiness: (body: { business: string; target_markets: string }) => apiFetch<Overview>('/service/business', { method: 'POST', body }),
  submitOnboarding: (body: { style_choice: StyleChoice; links: string[]; note: string }) =>
    apiFetch<Overview>('/service/onboarding', { method: 'POST', body }),
  requestChange: (body: { text: string; asset_ids: string[] }) => apiFetch<ServiceTask>('/service/requests', { method: 'POST', body }),
  approveSite: () => apiFetch<Overview>('/service/approve-site', { method: 'POST' }),
  styles: () => apiFetch<StyleCatalog>('/site-styles'),

  kit: (leadId: string) => apiFetch<ContactKit>(`/leads/${leadId}/contact-kit`),
  createKit: (leadId: string) => apiFetch<ContactKit>(`/leads/${leadId}/contact-kit`, { method: 'POST' }),
  setContactState: (leadId: string, state: Exclude<ContactState, 'none'>) =>
    apiFetch<ContactKit>(`/leads/${leadId}/contact-state`, { method: 'POST', body: { state } }),

  tasks: (status: 'open' | 'done' | 'all' = 'open', companyId?: string) =>
    apiFetch<ServiceTask[]>(`/ops/tasks?status=${status}${companyId ? `&company_id=${companyId}` : ''}`),
  updateTask: (id: string, status: ServiceTask['status']) => apiFetch<ServiceTask>(`/ops/tasks/${id}`, { method: 'PATCH', body: { status } }),
  workbench: (companyId: string) => apiFetch<Workbench>(`/ops/customers/${companyId}/workbench`),
  requestReview: (companyId: string) => apiFetch<Workbench>(`/ops/customers/${companyId}/request-review`, { method: 'POST' }),
  startBuyers: (companyId: string) => apiFetch<Workbench>(`/ops/customers/${companyId}/start-buyers`, { method: 'POST' }),
  setStyle: (companyId: string, body: Partial<SiteStyle> & { layout: Layout; primary?: string; accent?: string }) =>
    apiFetch<Workbench>(`/ops/customers/${companyId}/site-style`, { method: 'PUT', body }),
}

/** 资料类别的说明（向导与「我的资料」页共用）：拍什么、怎么拍。 */
export const MATERIAL_TIPS: Record<MaterialKind, { tip: string; use: string; capture: boolean }> = {
  product_photo: { tip: '每个主要产品拍 1–3 张，背景干净一点。', use: '放在网站的产品页，海外客户最先看的就是这个', capture: true },
  factory_photo: { tip: '车间、生产线、厂房外观、仓库都行，横着拍，光线亮一点。', use: '放在网站首页和「关于我们」，证明你是真工厂', capture: true },
  business_card: { tip: '你或业务员的名片，正面拍清楚。', use: '我们照着名片做网站的联系方式', capture: true },
  logo: { tip: '公司 Logo 图片。', use: '网站的颜色会照着 Logo 来配', capture: false },
  catalog: { tip: '产品目录、说明书、报价单，PDF 或照片都可以。', use: '我们从里面整理产品参数', capture: false },
  certificate: { tip: 'ISO、CE 等证书，拍清楚证书编号。', use: '放在网站的「资质认证」', capture: true },
}
