import { act, fireEvent, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TABS } from '@/components/local/TabPage'
import { AssistantPage } from '@/pages/AssistantPage'
import { LeadsPage } from '@/pages/LeadsPage'
import { MePage } from '@/pages/MePage'
import { SitePage } from '@/pages/SitePage'
import { renderRoutes } from '@/test/render'

const routes = [
  { path: '/assistant', element: <AssistantPage /> },
  { path: '/leads', element: <LeadsPage /> },
  { path: '/site', element: <SitePage /> },
  { path: '/me', element: <MePage /> },
]

describe('应用壳与 Tab', () => {
  it('底部 TabBar 显示「助手 / 商机 / 官网 / 我的」，无设计包品牌字样（用转义写法避免源码扫描误报）', () => {
    renderRoutes(routes, '/assistant')
    const nav = screen.getByRole('navigation', { name: '主导航' })
    expect(within(nav).getAllByRole('button').map((b) => b.textContent?.trim())).toEqual(['助手', '商机', '官网', '我的'])
    expect(document.body.textContent).not.toMatch(/\u5143\u5b9d/)
  })

  it('点击 Tab 切换路由', () => {
    const { router } = renderRoutes(routes, '/assistant')
    for (const tab of TABS.slice(1)) {
      fireEvent.click(screen.getByRole('button', { name: tab.label }))
      expect(router.state.location.pathname).toBe(tab.path)
    }
  })

  it('商机页为空态，官网页空态按钮跳转到助手', () => {
    const { router } = renderRoutes(routes, '/leads')
    expect(screen.getByText('暂无商机')).toBeTruthy()
    act(() => {
      void router.navigate('/site')
    })
    fireEvent.click(screen.getByRole('button', { name: '去和助手聊聊' }))
    expect(router.state.location.pathname).toBe('/assistant')
  })

  it('助手页发送后清空输入并弹出 Toast，3 秒后消失', () => {
    vi.useFakeTimers()
    try {
      renderRoutes(routes, '/assistant')
      const input = document.querySelector<HTMLInputElement | HTMLTextAreaElement>('.yb-agent-native')
      expect(input).toBeTruthy()
      fireEvent.change(input!, { target: { value: '找德国的阀门买家' } })
      fireEvent.keyDown(input!, { key: 'Enter' })
      expect(screen.getByText('对话功能即将上线')).toBeTruthy()
      expect(input!.value).toBe('')
      act(() => {
        vi.advanceTimersByTime(3100)
      })
      expect(screen.queryByText('对话功能即将上线')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
})
