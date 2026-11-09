import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Profile } from '@/api/endpoints'
import { demoProfile, installFakeServer, signedIn, type FakeServer, OPERATOR_USER } from '@/test/fakeServer'
import { renderRoutes } from '@/test/render'
import { inviteLink } from './AccountPages'
import { fromDraft, toDraft } from './ProductPages'
import { buildPatch, fieldText, SECTIONS } from './ProfilePages'

let server: FakeServer

beforeEach(() => {
  server = installFakeServer()
  server.on('GET', '/auth/me', OPERATOR_USER).on('GET', '/profile', demoProfile())
  signedIn()
})

describe('「我的」Tab', () => {
  it('显示完整度与分组；退出登录需二次确认', async () => {
    server.on('POST', '/auth/logout', null, 204)
    const { router } = renderRoutes('/me')
    expect((await screen.findAllByText('完整度 0%')).length).toBeGreaterThan(0)
    const main = screen.getByRole('main')
    for (const title of ['企业', '获客', '账户']) expect(within(main).getByText(title)).toBeTruthy()
    fireEvent.click(within(main).getByRole('button', { name: '退出登录' }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog.textContent).toContain('确定退出登录？')
    fireEvent.click(within(dialog).getByRole('button', { name: '退出登录' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
    expect(window.localStorage.getItem('aicmo.token')).toBeNull()
  })

  it('切换企业', async () => {
    const two = {
      ...OPERATOR_USER,
      companies: [...OPERATOR_USER.companies, { id: 'c2', name_cn: '温州泵业', name_en: '', role: 'member' as const }],
    }
    server.on('GET', '/auth/me', two)
    renderRoutes('/me')
    await screen.findAllByText('完整度 0%')
    fireEvent.click(within(screen.getByRole('main')).getByRole('button', { name: '切换企业' }))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '温州泵业' }))
    expect(await screen.findByText('已切换到 温州泵业')).toBeTruthy()
    expect(window.localStorage.getItem('aicmo.company')).toBe('c2')
  })
})

describe('企业档案', () => {
  it('缺失项可点击跳转到对应分区', async () => {
    const { router } = renderRoutes('/me/profile')
    fireEvent.click(await screen.findByText('核心优势'))
    await waitFor(() => expect(router.state.location.pathname).toBe('/me/profile/story'))
  })

  it('分区编辑：无改动时保存置灰；保存后提交变化字段', async () => {
    server.on('PATCH', '/profile', ({ body }: { body: unknown }) => demoProfile(body as Record<string, unknown>))
    const { router } = renderRoutes('/me/profile/basic')
    const save = (await screen.findByRole('button', { name: '保存' })) as HTMLButtonElement
    expect(save.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('成立年份'), { target: { value: '18' } })
    fireEvent.click(save)
    expect(await screen.findByText('请输入正确的年份')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('成立年份'), { target: { value: '2008' } })
    fireEvent.change(screen.getByLabelText('英文公司名'), { target: { value: ' Demo Valve ' } })
    fireEvent.click(save)
    await waitFor(() => expect(router.state.location.pathname).toBe('/me/profile'))
    expect(server.calls.find((c) => c.method === 'PATCH')!.body).toEqual({ founded_year: 2008, name_en: 'Demo Valve' })
  })

  it('加载失败显示网络错误空态并可重试', async () => {
    server.on('GET', '/profile', { error: { code: 'internal_error', message: '' } }, 500)
    renderRoutes('/me/profile')
    expect(await screen.findByText('网络不太顺畅')).toBeTruthy()
    server.on('GET', '/profile', demoProfile({ completeness: 50 }))
    fireEvent.click(screen.getByRole('button', { name: '重新加载' }))
    expect(await screen.findByText('完整度 50%')).toBeTruthy()
  })

  it('buildPatch 只包含变化字段并合并联系方式', () => {
    const profile = demoProfile({ contacts: { phone: '123' }, export_markets: ['USA'] }) as Profile
    const contacts = SECTIONS.contacts.fields
    const draft = Object.fromEntries(contacts.map((f) => [f.key, fieldText(profile, f.key)]))
    draft['contacts.email'] = ' a@b.com '
    expect(buildPatch(profile, contacts, draft)).toEqual({ contacts: { phone: '123', email: 'a@b.com' } })
    const market = SECTIONS.market.fields
    expect(buildPatch(profile, market, { export_markets: 'USA, Germany', main_customers_public: '' })).toEqual({
      export_markets: ['USA', 'Germany'],
    })
    expect(buildPatch(profile, SECTIONS.basic.fields, { founded_year: '' , name_en: '', employees: '', factory_area: '', annual_capacity: '' })).toEqual({})
  })
})

describe('产品管理', () => {
  it('空态引导新增；新增时必须填写英文名', async () => {
    server.on('GET', '/products', [])
    const { router } = renderRoutes('/me/products')
    fireEvent.click(await screen.findByRole('button', { name: '新增产品' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/me/products/new'))
    fireEvent.change(await screen.findByLabelText('中文名称'), { target: { value: '球阀' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(await screen.findByText('请填写英文名称')).toBeTruthy()
  })

  it('删除产品需要确认', async () => {
    const product = { ...fromDraft(toDraft()), id: 'p1', name_en: 'Ball Valve', specs: {}, source: 'manual' }
    server.on('GET', '/products/p1', product).on('DELETE', '/products/p1', null, 204).on('GET', '/products', [])
    const { router } = renderRoutes('/me/products/p1')
    fireEvent.click(await screen.findByRole('button', { name: '删除' }))
    expect((await screen.findByRole('dialog')).textContent).toContain('删除这个产品？')
    fireEvent.click(screen.getAllByRole('button', { name: '删除' }).at(-1)!)
    await waitFor(() => expect(router.state.location.pathname).toBe('/me/products'))
    expect(server.calls.some((c) => c.method === 'DELETE' && c.path === '/products/p1')).toBe(true)
  })

  it('草稿转换', () => {
    expect(fromDraft({ ...toDraft(), name_en: ' V ', keywords_en: 'a, b，a' })).toMatchObject({ name_en: 'V', keywords_en: ['a', 'b'] })
  })
})

describe('成员', () => {
  it('邀请链接对 token 编码', () => {
    expect(inviteLink('a/b?c', 'https://app.example')).toBe('https://app.example/invite/a%2Fb%3Fc')
  })
})

describe('账号安全', () => {
  it('修改密码：两次输入不一致时提示并置灰；校验强度；提交当前密码与新密码', async () => {
    server.on('POST', '/auth/password', null, 204)
    renderRoutes('/me/security')
    const submit = (await screen.findByRole('button', { name: '修改密码' })) as HTMLButtonElement
    expect(submit.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('当前密码'), { target: { value: 'OldPass123' } })
    fireEvent.change(screen.getByLabelText('新密码'), { target: { value: 'abcdefgh' } })
    fireEvent.change(screen.getByLabelText('再次输入新密码'), { target: { value: 'abcdefgx' } })
    expect(screen.getByText('两次输入的新密码不一致')).toBeTruthy()
    expect(submit.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('再次输入新密码'), { target: { value: 'abcdefgh' } })
    fireEvent.click(submit)
    expect(await screen.findByText('密码需同时包含字母和数字')).toBeTruthy()
    expect(server.calls.some((c) => c.path === '/auth/password')).toBe(false)

    fireEvent.change(screen.getByLabelText('新密码'), { target: { value: 'NewPass123' } })
    fireEvent.change(screen.getByLabelText('再次输入新密码'), { target: { value: 'NewPass123' } })
    fireEvent.click(submit)
    expect(await screen.findByText('密码已修改，其他设备需要重新登录')).toBeTruthy()
    expect(server.calls.find((c) => c.path === '/auth/password')!.body).toEqual({ current_password: 'OldPass123', new_password: 'NewPass123' })
    expect((screen.getByLabelText('当前密码') as HTMLInputElement).value).toBe('')
  })

  it('当前密码错误时显示后端提示', async () => {
    server.on('POST', '/auth/password', { error: { code: 'wrong_password', message: '当前密码不正确' } }, 400)
    renderRoutes('/me/security')
    fireEvent.change(await screen.findByLabelText('当前密码'), { target: { value: 'x' } })
    fireEvent.change(screen.getByLabelText('新密码'), { target: { value: 'NewPass123' } })
    fireEvent.change(screen.getByLabelText('再次输入新密码'), { target: { value: 'NewPass123' } })
    fireEvent.click(screen.getByRole('button', { name: '修改密码' }))
    expect(await screen.findByText('当前密码不正确')).toBeTruthy()
  })
})
