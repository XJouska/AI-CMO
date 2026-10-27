import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Extraction } from '@/api/endpoints'
import { demoProfile, DEMO_USER, installFakeServer, signedIn, type FakeServer } from '@/test/fakeServer'
import { renderRoutes } from '@/test/render'
import { describeValue, editableText, parseEdited } from './changes'

let server: FakeServer

const extraction: Extraction = {
  id: 'e1',
  source: 'url',
  status: 'succeeded',
  error: '',
  created_at: '',
  progress: [],
  changes: [
    { id: 'f:founded_year', group: 'company', field: 'founded_year', label: '成立年份', current: null, value: 2008 },
    { id: 'f:certifications', group: 'certification', field: 'certifications', label: '资质认证', current: ['CE'], value: ['CE', 'ISO 9001'] },
    { id: 'f:usp', group: 'company', field: 'usp', label: '核心优势', current: '', value: '<script>alert(1)</script>' },
    {
      id: 'p:0',
      group: 'product',
      field: 'product',
      label: '新产品',
      current: null,
      value: { name_en: 'Ball Valve', name_cn: '球阀', category: 'Valves', keywords_en: ['ball valve'] },
    },
  ],
}

beforeEach(() => {
  server = installFakeServer()
  server.on('GET', '/auth/me', DEMO_USER).on('GET', '/profile', demoProfile())
  signedIn()
})

describe('建档引导', () => {
  it('网址校验：非法网址只走 Toast；合法网址补全协议后创建任务并进入进度页', async () => {
    server.on('POST', '/extractions', { ...extraction, status: 'pending', changes: [] }).on('GET', '/extractions/e1', {
      ...extraction,
      status: 'running',
      progress: [{ key: 'fetch', label: '读取网站内容', status: 'running' }],
    })
    const { router } = renderRoutes('/onboarding/url')
    const field = await screen.findByLabelText('网址')
    fireEvent.change(field, { target: { value: 'javascript:alert(1)' } })
    fireEvent.click(screen.getByRole('button', { name: '开始整理' }))
    expect(await screen.findByText('请输入正确的网址')).toBeTruthy()
    expect(server.calls.some((c) => c.method === 'POST')).toBe(false)

    fireEvent.change(field, { target: { value: 'demo-valve.com' } })
    fireEvent.click(screen.getByRole('button', { name: '开始整理' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/extractions/e1'))
    expect(server.calls.find((c) => c.method === 'POST')!.body).toEqual({ source: 'url', url: 'https://demo-valve.com/' })
    expect(await screen.findByText(/读取网站内容/)).toBeTruthy()
  })

  it('抽取失败：保留页面并用 Toast 说明原因，提供重试', async () => {
    server.on('GET', '/extractions/e1', { ...extraction, status: 'failed', error: '该网址无法访问', changes: [] })
    const { router } = renderRoutes('/extractions/e1')
    expect(await screen.findByText('整理失败')).toBeTruthy()
    expect((await screen.findAllByText('该网址无法访问')).length).toBeGreaterThanOrEqual(1)
    fireEvent.click(screen.getByRole('button', { name: '重新整理' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/onboarding'))
  })

  it('抽取完成后自动进入确认页', async () => {
    server.on('GET', '/extractions/e1', extraction)
    const { router } = renderRoutes('/extractions/e1')
    await waitFor(() => expect(router.state.location.pathname).toBe('/extractions/e1/review'))
  })
})

describe('确认变更页', () => {
  it('默认全选；取消勾选后计数变化；内容按纯文本显示', async () => {
    server.on('GET', '/extractions/e1', extraction)
    renderRoutes('/extractions/e1/review')
    expect(await screen.findByRole('button', { name: '确认合并（4 项）' })).toBeTruthy()
    // 用户 / AI 内容不会被当作 HTML 解析
    expect(screen.getByText('<script>alert(1)</script>')).toBeTruthy()
    expect(document.querySelector('script')).toBeNull()

    const row = document.querySelector('[data-change-id="f:usp"]') as HTMLElement
    fireEvent.click(within(row).getByRole('button', { name: '已选中' }))
    expect(screen.getByRole('button', { name: '确认合并（3 项）' })).toBeTruthy()
  })

  it('全部取消时按钮置灰；提交只包含勾选项和修改后的值', async () => {
    server
      .on('GET', '/extractions/e1', extraction)
      .on('POST', '/extractions/e1/apply', { changed_fields: ['founded_year'], created_products: [], completeness: 34 })
    const { router } = renderRoutes('/extractions/e1/review')
    await screen.findByRole('button', { name: '确认合并（4 项）' })
    for (const id of ['f:founded_year', 'f:certifications', 'f:usp', 'p:0']) {
      const row = document.querySelector(`[data-change-id="${id}"]`) as HTMLElement
      fireEvent.click(within(row).getByRole('button', { name: '已选中' }))
    }
    const disabled = screen.getByRole('button', { name: '请至少选择一项' }) as HTMLButtonElement
    expect(disabled.disabled).toBe(true)

    const yearRow = document.querySelector('[data-change-id="f:founded_year"]') as HTMLElement
    fireEvent.click(within(yearRow).getByRole('button', { name: '未选中' }))
    fireEvent.click(screen.getByRole('button', { name: '确认合并（1 项）' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/me/profile'))
    const apply = server.calls.find((c) => c.path === '/extractions/e1/apply')!
    expect(apply.body).toEqual({ accept: ['f:founded_year'], overrides: {} })
    expect(await screen.findByText('已更新档案，完整度 34%')).toBeTruthy()
  })

  it('没有变更时显示空态', async () => {
    server.on('GET', '/extractions/e1', { ...extraction, changes: [] })
    renderRoutes('/extractions/e1/review')
    expect(await screen.findByText('没有发现新的信息')).toBeTruthy()
  })
})

describe('变更值转换', () => {
  it('显示与编辑', () => {
    const [year, certs, , product] = extraction.changes
    expect(describeValue(['CE', 'ISO 9001'])).toBe('CE、ISO 9001')
    expect(describeValue(product.value)).toBe('Ball Valve · 球阀 · Valves')
    expect(describeValue(null)).toBe('')
    expect(editableText(certs, certs.value)).toBe('CE, ISO 9001')
    expect(editableText(product, product.value)).toBe('Ball Valve')
    expect(parseEdited(certs, 'CE， UL、CE')).toEqual(['CE', 'UL'])
    expect(parseEdited(year, '2010')).toBe(2010)
    expect(parseEdited(year, 'abc')).toBe(2008)
    expect(parseEdited(product, ' Gate Valve ')).toMatchObject({ name_en: 'Gate Valve', name_cn: '球阀' })
  })
})
