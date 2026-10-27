import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { DEMO_USER, installFakeServer, type FakeServer } from '@/test/fakeServer'
import { renderRoutes } from '@/test/render'

let server: FakeServer

function input(label: string) {
  return screen.getByLabelText(label) as HTMLInputElement
}

function primary(name: string) {
  return screen.getByRole('button', { name }) as HTMLButtonElement
}

beforeEach(() => {
  server = installFakeServer()
})

describe('登录 / 注册（规范 form-validation-timing）', () => {
  it('信息不完整时登录按钮置灰', () => {
    renderRoutes('/login')
    expect(primary('登录').disabled).toBe(true)
    fireEvent.change(input('邮箱'), { target: { value: 'boss@factory.com' } })
    expect(primary('登录').disabled).toBe(true)
    fireEvent.change(input('密码'), { target: { value: 'x' } })
    expect(primary('登录').disabled).toBe(false)
    expect(input('密码').type).toBe('password')
  })

  it('邮箱格式错误只走 Toast，不发请求', async () => {
    renderRoutes('/login')
    fireEvent.change(input('邮箱'), { target: { value: 'not-email' } })
    fireEvent.change(input('密码'), { target: { value: 'Factory123' } })
    fireEvent.click(primary('登录'))
    expect(await screen.findByText('邮箱格式不正确')).toBeTruthy()
    expect(server.calls).toEqual([])
    expect(document.querySelector('.yb-form-error, [role="alert"]')).toBeNull()
  })

  it('服务端错误显示后端文案的 Toast', async () => {
    server.on('POST', '/auth/login', { error: { code: 'invalid_credentials', message: '邮箱或密码不正确' } }, 401)
    renderRoutes('/login')
    fireEvent.change(input('邮箱'), { target: { value: 'boss@factory.com' } })
    fireEvent.change(input('密码'), { target: { value: 'Wrong1234' } })
    fireEvent.click(primary('登录'))
    expect(await screen.findByText('邮箱或密码不正确')).toBeTruthy()
  })

  it('登录成功保存 token 并按企业情况跳转', async () => {
    server.on('POST', '/auth/login', { token: 'tok', expires_at: '', user: DEMO_USER }).on('GET', '/auth/me', DEMO_USER)
    const { router } = renderRoutes('/login')
    fireEvent.change(input('邮箱'), { target: { value: ' boss@factory.com ' } })
    fireEvent.change(input('密码'), { target: { value: 'Factory123' } })
    fireEvent.keyDown(input('密码'), { key: 'Enter' })
    await waitFor(() => expect(router.state.location.pathname).toBe('/assistant'))
    expect(window.localStorage.getItem('aicmo.token')).toBe('tok')
    expect(window.localStorage.getItem('aicmo.company')).toBe('c1')
    expect(server.calls[0].body).toEqual({ email: 'boss@factory.com', password: 'Factory123' })
  })

  it('注册校验密码强度，新用户进入创建企业页', async () => {
    const fresh = { ...DEMO_USER, companies: [] }
    server.on('POST', '/auth/register', { token: 'tok', expires_at: '', user: fresh }).on('GET', '/auth/me', fresh)
    const { router } = renderRoutes('/register')
    fireEvent.change(input('称呼'), { target: { value: '王总' } })
    fireEvent.change(input('邮箱'), { target: { value: 'boss@factory.com' } })
    fireEvent.change(input('密码'), { target: { value: 'abcdefgh' } })
    fireEvent.click(primary('注册'))
    expect(await screen.findByText('密码需同时包含字母和数字')).toBeTruthy()
    expect(server.calls).toEqual([])

    fireEvent.change(input('密码'), { target: { value: 'Factory123' } })
    fireEvent.click(primary('注册'))
    await waitFor(() => expect(router.state.location.pathname).toBe('/onboarding/company'))
  })
})
