import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import type { SiteContent, SiteOut, SiteVersionOut } from '@/site/api'
import { flagsFor, sectionData, sectionDraft, sectionSummary } from '@/site/model'
import { demoProfile, DEMO_USER, installFakeServer, signedIn, type FakeServer } from '@/test/fakeServer'
import { renderRoutes } from '@/test/render'

let server: FakeServer

const content: SiteContent = {
  company_name: 'Demo Valve',
  hero: { headline: 'Reliable Ball Valves', subheadline: 'Factory direct', cta: 'Request a Quote' },
  about: { title: 'About Us', body: '<p>Since 2008</p>', highlights: ['ISO 9001'] },
  products: { title: 'Products', items: [{ product_id: 'p1', name: 'Ball Valve', summary: 's', image_asset_id: '', keywords: [] }] },
  factory: { title: 'Factory', body: '', stats: [{ label: 'Employees', value: '120' }], image_asset_ids: [] },
  certificates: { title: 'Certs', items: ['ISO 9001', 'CE'], image_asset_ids: [] },
  markets: { title: 'Markets', items: ['Germany'] },
  cases: { title: 'Cases', items: [] },
  faq: { title: 'FAQ', items: [] },
  contact: { title: 'Contact', email: 'sales@demo.example', phone: '', whatsapp: '', address: '' },
  seo: { title: 'Demo Valve', description: 'desc', keywords: ['ball valve'] },
}

function site(overrides: Partial<SiteOut> = {}): SiteOut {
  return {
    id: 's1',
    status: 'draft',
    template_key: 'industrial',
    url: 'https://demo.sites.example/',
    subdomain_host: 'demo.sites.example',
    custom_domain: null,
    domain_verified: false,
    domain_token: '',
    draft_version_id: 'v2',
    published_version_id: null,
    has_unpublished_changes: true,
    published_at: null,
    task: { kind: 'generate', status: 'idle', progress: [], error: '' },
    health_score: 72,
    unresolved_flags: 1,
    inquiry_count: 1,
    new_inquiry_count: 1,
    ...overrides,
  }
}

const draft: SiteVersionOut = {
  id: 'v2',
  content,
  flags: [{ section: 'hero', field: 'headline', text: '500 clients', reason: '数字不在企业档案中' }],
  note: 'AI 生成',
  created_at: '2026-10-27T10:00:00',
  is_published: false,
  is_draft: true,
}

beforeEach(() => {
  server = installFakeServer()
  server
    .on('GET', '/auth/me', DEMO_USER)
    .on('GET', '/profile', demoProfile({ completeness: 30 }))
    .on('GET', /^\/site\/inquiries\?limit=\d+$/, [
      { id: 'i1', name: 'John', email: 'j@b.example', company_name: '<b>Buyer</b> GmbH', country: 'Germany', product_ref: 'Ball Valve', message: '<script>alert(1)</script> quote please', status: 'new', created_at: '2026-10-27T09:00:00' },
    ])
  signedIn()
})

describe('官网 Tab 状态', () => {
  it('未生成且档案不足 60%：引导先完善档案', async () => {
    server.on('GET', '/site', null)
    const { router } = renderRoutes('/site')
    expect(await screen.findByText('企业档案完整度需要达到 60%（当前 30%）')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '先完善企业档案' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/me/profile'))
  })

  it('未生成且档案足够：点击生成后显示进度', async () => {
    server
      .on('GET', '/site', null)
      .on('GET', '/profile', demoProfile({ completeness: 80 }))
      .on('POST', '/site/generate', site({ draft_version_id: null, task: { kind: 'generate', status: 'running', error: '', progress: [{ key: 'write', label: 'AI 撰写英文文案', status: 'running' }] } }))
    renderRoutes('/site')
    fireEvent.click(await screen.findByRole('button', { name: '生成我的英文官网' }))
    expect(await screen.findByText('正在生成官网')).toBeTruthy()
    expect(screen.getByText(/AI 撰写英文文案/)).toBeTruthy()
  })

  it('已有草稿：状态、分区（需确认标记）、询盘（纯文本）、发布确认', async () => {
    let current = site()
    server
      .on('GET', '/site', () => current)
      .on('GET', '/site/draft', draft)
      .on('POST', '/site/publish', () => {
        current = site({ task: { kind: 'publish', status: 'running', progress: [], error: '' } })
        return current
      })
    renderRoutes('/site')
    expect(await screen.findByText('https://demo.sites.example/')).toBeTruthy()
    expect(screen.getByText('72 分')).toBeTruthy()
    expect(await screen.findByText('1 处需确认')).toBeTruthy()
    expect(await screen.findByText('<script>alert(1)</script> quote please')).toBeTruthy()
    expect(document.querySelector('.site-dashboard script')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '发布更新' }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog.textContent).toContain('将把当前草稿发布到 https://demo.sites.example/')
    expect(dialog.textContent).toContain('还有 1 处内容需要确认是否属实')
    fireEvent.click(within(dialog).getByRole('button', { name: '发布更新' }))
    await waitFor(() => expect(server.calls.some((c) => c.method === 'POST' && c.path === '/site/publish')).toBe(true))
  })

  it('没有改动时发布按钮置灰', async () => {
    server.on('GET', '/site', site({ has_unpublished_changes: false, status: 'published', published_version_id: 'v2' })).on('GET', '/site/draft', draft)
    renderRoutes('/site')
    const button = (await screen.findByRole('button', { name: '已发布' })) as HTMLButtonElement
    expect(button.disabled).toBe(true)
  })

  it('加载失败显示网络错误', async () => {
    server.on('GET', '/site', { error: { code: 'internal_error', message: '' } }, 500)
    renderRoutes('/site')
    expect(await screen.findByText('网络不太顺畅')).toBeTruthy()
  })
})

describe('分区编辑', () => {
  it('保存修改后的字段；需确认内容可标记属实', async () => {
    server
      .on('GET', '/site', site())
      .on('GET', '/site/draft', draft)
      .on('PUT', '/site/sections/hero', { ...draft, id: 'v3' })
      .on('POST', '/site/flags/ack', { ...draft, flags: [] })
    const { router } = renderRoutes('/site/sections/hero')
    expect(await screen.findByText('500 clients')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '属实' }))
    await waitFor(() => expect(server.calls.find((c) => c.path === '/site/flags/ack')?.body).toEqual({ section: 'hero', field: 'headline', text: '500 clients' }))

    const save = screen.getByRole('button', { name: '保存' }) as HTMLButtonElement
    expect(save.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('主标题'), { target: { value: ' New Headline ' } })
    fireEvent.click(save)
    await waitFor(() => expect(router.state.location.pathname).toBe('/site'))
    const body = server.calls.find((c) => c.method === 'PUT')!.body as { data: Record<string, unknown> }
    expect(body.data.headline).toBe('New Headline')
  })

  it('来自档案的分区只读', async () => {
    server.on('GET', '/site', site()).on('GET', '/site/draft', draft)
    renderRoutes('/site/sections/certificates')
    expect(await screen.findByText('该分区来自企业档案，请在「我的 → 企业档案」中修改')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '保存' })).toBeNull()
  })
})

describe('预览', () => {
  it('iframe 使用沙箱且不允许脚本', async () => {
    server.on('GET', '/site/preview-url', { url: '/api/v1/public/site-preview/s1/v2/index.html?exp=1&sig=x', expires_in: 1800 })
    renderRoutes('/site/preview')
    await waitFor(() => expect(document.querySelector('iframe')).toBeTruthy())
    const iframe = document.querySelector('iframe')!
    expect(iframe.getAttribute('sandbox')).toBe('')
    expect(iframe.getAttribute('src')).toContain('/public/site-preview/')
  })
})

describe('官网纯逻辑', () => {
  it('分区草稿与数据互转（保留表单之外的字段）', () => {
    const d = sectionDraft(content, 'about')
    expect(d.highlights).toBe('ISO 9001')
    const data = sectionData(content, 'about', { ...d, highlights: 'A\n\n B ' })
    expect(data.highlights).toEqual(['A', 'B'])
    expect(sectionData(content, 'seo', { ...sectionDraft(content, 'seo'), keywords: 'a, b，a' }).keywords).toEqual(['a', 'b'])
    expect(sectionData(content, 'factory', sectionDraft(content, 'factory')).stats).toEqual(content.factory.stats)
    expect(flagsFor([...draft.flags, { ...draft.flags[0], ack: true }], 'hero')).toHaveLength(1)
    expect(sectionSummary(content, 'about')).toBe('Since 2008')
    expect(sectionSummary(content, 'factory')).toBe('Employees 120')
  })
})
