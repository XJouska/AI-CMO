// 后端接口类型与调用函数（与 backend/app/modules/* 的 Pydantic 模型保持一致）。
import { apiFetch } from './client'

export type Role = 'owner' | 'member' | 'operator'

export interface CompanyBrief {
  id: string
  name_cn: string
  name_en: string
  role: Role
}

export interface User {
  id: string
  email: string
  name: string
  is_staff: boolean
  companies: CompanyBrief[]
}

export interface SessionOut {
  token: string
  expires_at: string
  user: User
}

export interface MissingItem {
  key: string
  label: string
  weight: number
  section: ProfileSection | 'products'
}

export type ProfileSection = 'basic' | 'market' | 'certs' | 'story' | 'contacts'

export interface Contacts {
  email?: string
  phone?: string
  whatsapp?: string
  address?: string
  website?: string
}

export interface Profile {
  company_id: string
  name_cn: string
  name_en: string
  founded_year: number | null
  employees: string
  factory_area: string
  annual_capacity: string
  export_markets: string[]
  certifications: string[]
  main_customers_public: string[]
  usp: string
  about_en: string
  contacts: Contacts
  field_sources: Record<string, { source: string; extraction_id: string | null; at: string }>
  completeness: number
  missing: MissingItem[]
  product_count: number
}

export type ProfilePatch = Partial<Omit<Profile, 'company_id' | 'name_cn' | 'field_sources' | 'completeness' | 'missing' | 'product_count'>>

export interface Product {
  id: string
  name_en: string
  name_cn: string
  category: string
  hs_codes: string[]
  specs: Record<string, string>
  moq: string
  lead_time: string
  applications: string[]
  keywords_en: string[]
  images: string[]
  source: string
}

export type ProductInput = Omit<Product, 'id' | 'source'>

export type AssetKind = 'image' | 'certificate' | 'catalog' | 'pdf'

export interface Asset {
  id: string
  kind: AssetKind
  mime: string
  size: number
  display_name: string
  has_text: boolean
  created_at: string
}

export interface Member {
  user_id: string
  name: string
  email: string
  role: Role
  is_me: boolean
}

export type StepStatus = 'pending' | 'running' | 'done' | 'failed'

export interface ExtractionStep {
  key: string
  label: string
  status: StepStatus
}

export type ChangeGroup = 'company' | 'product' | 'certification' | 'contact'

export interface ExtractionChange {
  id: string
  group: ChangeGroup
  field: string
  label: string
  current: unknown
  value: unknown
}

export type ExtractionStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'applied'

export interface Extraction {
  id: string
  source: 'url' | 'file' | 'chat'
  status: ExtractionStatus
  progress: ExtractionStep[]
  changes: ExtractionChange[]
  error: string
  created_at: string
}

export const api = {
  register: (body: { email: string; password: string; name: string }) =>
    apiFetch<SessionOut>('/auth/register', { method: 'POST', body }),
  login: (body: { email: string; password: string }) => apiFetch<SessionOut>('/auth/login', { method: 'POST', body }),
  me: () => apiFetch<User>('/auth/me'),
  logout: () => apiFetch<void>('/auth/logout', { method: 'POST' }),

  createCompany: (body: { name_cn: string; name_en: string }) =>
    apiFetch<CompanyBrief & { plan: string }>('/companies', { method: 'POST', body }),
  members: (companyId: string) => apiFetch<Member[]>(`/companies/${companyId}/members`),
  removeMember: (companyId: string, userId: string) =>
    apiFetch<void>(`/companies/${companyId}/members/${userId}`, { method: 'DELETE' }),
  createInvite: (companyId: string) =>
    apiFetch<{ token: string; expires_at: string; role: Role }>(`/companies/${companyId}/invites`, {
      method: 'POST',
      body: { role: 'member' },
    }),
  previewInvite: (token: string) =>
    apiFetch<{ company_name: string; role: Role; expires_at: string }>(`/invites/${encodeURIComponent(token)}`),
  acceptInvite: (token: string) =>
    apiFetch<CompanyBrief>(`/invites/${encodeURIComponent(token)}/accept`, { method: 'POST' }),

  profile: () => apiFetch<Profile>('/profile'),
  patchProfile: (body: ProfilePatch) => apiFetch<Profile>('/profile', { method: 'PATCH', body }),

  products: () => apiFetch<Product[]>('/products'),
  product: (id: string) => apiFetch<Product>(`/products/${id}`),
  createProduct: (body: Partial<ProductInput>) => apiFetch<Product>('/products', { method: 'POST', body }),
  patchProduct: (id: string, body: Partial<ProductInput>) => apiFetch<Product>(`/products/${id}`, { method: 'PATCH', body }),
  deleteProduct: (id: string) => apiFetch<void>(`/products/${id}`, { method: 'DELETE' }),

  assets: (kind?: AssetKind) => apiFetch<Asset[]>(kind ? `/assets?kind=${kind}` : '/assets'),
  uploadAsset: (file: File, kind: AssetKind) => {
    const form = new FormData()
    form.append('file', file)
    form.append('kind', kind)
    return apiFetch<Asset>('/assets', { method: 'POST', body: form })
  },
  deleteAsset: (id: string) => apiFetch<void>(`/assets/${id}`, { method: 'DELETE' }),
  assetUrl: (id: string) => apiFetch<{ url: string; expires_in: number }>(`/assets/${id}/download-url`),

  createExtraction: (body: { source: 'url'; url: string } | { source: 'file'; asset_ids: string[] } | { source: 'chat'; text: string }) =>
    apiFetch<Extraction>('/extractions', { method: 'POST', body }),
  extraction: (id: string) => apiFetch<Extraction>(`/extractions/${id}`),
  applyExtraction: (id: string, body: { accept: string[]; overrides: Record<string, unknown> }) =>
    apiFetch<{ changed_fields: string[]; created_products: string[]; completeness: number }>(`/extractions/${id}/apply`, {
      method: 'POST',
      body,
    }),
}
