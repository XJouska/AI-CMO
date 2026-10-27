import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { demoProfile, DEMO_USER, hangingSse, installFakeServer, signedIn, sseBody, type FakeServer } from '@/test/fakeServer'
import { renderRoutes } from '@/test/render'
import { WEAK_NETWORK_MS } from './useConversation'
import { welcomeSuggestions } from './suggestions'

// vitest 在 apps/web 目录下运行
const contract = JSON.parse(readFileSync(path.resolve(process.cwd(), '../../contracts/sse-assistant.json'), 'utf8'))

let server: FakeServer

beforeEach(() => {
  server = installFakeServer()
  server
    .on('GET', '/auth/me', DEMO_USER)
    .on('GET', '/profile', demoProfile({ completeness: 30 }))
    .on('POST', '/assistant/conversations', { id: 'c1', title: '', updated_at: '' })
    .on('GET', '/assistant/conversations', [])
  signedIn()
})

function input() {
  return document.querySelector<HTMLInputElement | HTMLTextAreaElement>('.yb-agent-native')!
}

async function typeAndSend(text: string) {
  await screen.findByText(/你好，我是/)
  fireEvent.change(input(), { target: { value: text } })
  fireEvent.keyDown(input(), { key: 'Enter' })
}

describe('助手：发送与流式回答', () => {
  it('欢迎页根据档案完整度给出建议，点击建议直接发送', async () => {
    server.on('POST', '/assistant/conversations/c1/messages', () => sseBody(contract.samples.completedWithTool))
    renderRoutes('/assistant')
    fireEvent.click(await screen.findByRole('button', { name: /帮我补充企业档案/ }))
    expect(await screen.findByText('档案情况')).toBeTruthy()
    const call = server.calls.find((c) => c.path === '/assistant/conversations/c1/messages')!
    expect(call.body).toEqual({ text: '帮我补充企业档案' })
  })

  it('完成态：用户消息、进度、卡片、Markdown 正文、追问、工具栏；地址栏记录会话', async () => {
    server.on('POST', '/assistant/conversations/c1/messages', () => sseBody(contract.samples.completedWithTool))
    const { router } = renderRoutes('/assistant')
    await typeAndSend('我的档案怎么样')
    expect(await screen.findByText('档案情况')).toBeTruthy()
    expect(screen.getByText('我的档案怎么样')).toBeTruthy()
    expect(screen.getByText('30%').tagName).toBe('STRONG')
    expect(screen.getByText('英文公司介绍')).toBeTruthy()
    expect(screen.getByText('完整度 30%')).toBeTruthy()
    expect(screen.getByRole('button', { name: /帮我找海外采购商/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: '复制' })).toBeTruthy()
    expect(input().value).toBe('')
    await waitFor(() => expect(router.state.location.search).toBe('?c=c1'))
  })

  it('生成中：输入框显示停止按钮，不显示完成态操作；停止后可重试', async () => {
    server
      .on('POST', '/assistant/conversations/c1/messages', ({ signal }: { signal?: AbortSignal | null }) =>
        hangingSse([{ event: 'message.start', data: { message_id: 'm1', conversation_id: 'c1' } }, { event: 'block.delta', data: { block_index: 0, text: '正在整理' } }], signal),
      )
      .on('POST', '/assistant/conversations/c1/messages/m1/cancel', { id: 'm1', state: 'cancelled' })
      .on('POST', '/assistant/conversations/c1/messages/m1/retry', () => sseBody(contract.samples.completedWithTool))
    renderRoutes('/assistant')
    await typeAndSend('写一段很长的介绍')
    expect(await screen.findByText('正在整理')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '复制' })).toBeNull()
    const stop = document.querySelector('.yb-tabbar [aria-label="停止"], .yb-tabbar [aria-label*="停止"]')
    expect(stop).toBeTruthy()
    fireEvent.click(stop!)
    expect(await screen.findByText('已停止生成')).toBeTruthy()
    await waitFor(() => expect(server.calls.some((c) => c.path.endsWith('/m1/cancel'))).toBe(true))
    expect(screen.getByText('正在整理')).toBeTruthy() // 已生成的内容保留

    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(await screen.findByText('档案情况')).toBeTruthy()
  })

  it('失败：保留已生成内容并提供重试', async () => {
    server.on('POST', '/assistant/conversations/c1/messages', () => sseBody(contract.samples.failedAfterPartial))
    renderRoutes('/assistant')
    await typeAndSend('你好')
    expect(await screen.findByText('AI 暂时没有响应，请稍后重试')).toBeTruthy()
    expect(screen.getByText('正在为你整理')).toBeTruthy()
    expect(screen.getByRole('button', { name: '重试' })).toBeTruthy()
  })

  it('弱网：5 秒没有数据时显示轻提示，保持输出中', async () => {
    server.on('POST', '/assistant/conversations/c1/messages', ({ signal }: { signal?: AbortSignal | null }) =>
      hangingSse([{ event: 'message.start', data: { message_id: 'm1', conversation_id: 'c1' } }], signal),
    )
    vi.useFakeTimers({ shouldAdvanceTime: true })
    renderRoutes('/assistant')
    await typeAndSend('你好')
    await screen.findByText('思考中')
    try {
      act(() => {
        vi.advanceTimersByTime(WEAK_NETWORK_MS - 100)
      })
      expect(screen.queryByText('网络有点慢，正在继续生成')).toBeNull()
      act(() => {
        vi.advanceTimersByTime(200)
      })
      expect(screen.getByText('网络有点慢，正在继续生成')).toBeTruthy()
      expect(screen.getByText('思考中')).toBeTruthy()
    } finally {
      vi.useRealTimers()
    }
  })

  it('网络断开：标记错误并用 Toast 提示', async () => {
    server.on('POST', '/assistant/conversations/c1/messages', () => {
      throw new TypeError('Failed to fetch')
    })
    renderRoutes('/assistant')
    await typeAndSend('你好')
    expect(await screen.findByText('网络连接失败，请稍后重试')).toBeTruthy()
    server.on('POST', '/assistant/conversations/c1/messages', () => sseBody(contract.samples.completedWithTool))
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(await screen.findByText('档案情况')).toBeTruthy()
    expect(screen.getAllByText('你好')).toHaveLength(1) // 重发时不重复显示用户消息
  })
})

describe('助手：卡片', () => {
  it('确认卡片：确认后调用接口并显示结果，不再显示按钮', async () => {
    let status = 'pending_confirm'
    server
      .on('POST', '/assistant/conversations/c1/messages', () => sseBody(contract.samples.needsConfirmation))
      .on('GET', '/assistant/tool-runs/r1', () => ({ id: 'r1', tool_name: 'product_delete', status, summary: '', error: '' }))
      .on('POST', '/assistant/tool-runs/r1/confirm', () => {
        status = 'succeeded'
        return { id: 'r1', tool_name: 'product_delete', status, summary: '已删除 Ball Valve', error: '' }
      })
    renderRoutes('/assistant')
    await typeAndSend('删除球阀')
    const card = (await screen.findByText('将删除产品「Ball Valve」，删除后无法恢复。')).closest('.assistant-confirm') as HTMLElement
    expect(screen.queryByRole('button', { name: /帮我/ })).toBeNull() // 等待确认时没有追问
    fireEvent.click(within(card).getByRole('button', { name: '删除' }))
    expect(await screen.findByText('已删除 Ball Valve')).toBeTruthy()
    await waitFor(() => expect(within(card).queryByRole('button', { name: '删除' })).toBeNull())
    expect(within(card).getByText('已完成')).toBeTruthy()
  })

  it('取消确认', async () => {
    let status = 'pending_confirm'
    server
      .on('POST', '/assistant/conversations/c1/messages', () => sseBody(contract.samples.needsConfirmation))
      .on('GET', '/assistant/tool-runs/r1', () => ({ id: 'r1', tool_name: 'product_delete', status, summary: '', error: '' }))
      .on('POST', '/assistant/tool-runs/r1/reject', () => {
        status = 'rejected'
        return { id: 'r1', tool_name: 'product_delete', status, summary: '已取消', error: '' }
      })
    renderRoutes('/assistant')
    await typeAndSend('删除球阀')
    const card = (await screen.findByText(/将删除产品/)).closest('.assistant-confirm') as HTMLElement
    fireEvent.click(within(card).getByRole('button', { name: '取消' }))
    expect(await within(card).findByText('已取消')).toBeTruthy()
    expect(server.calls.some((c) => c.path.endsWith('/confirm'))).toBe(false)
  })

  it('未知卡片类型降级为文本说明', async () => {
    server.on('POST', '/assistant/conversations/c1/messages', () => sseBody(contract.samples.unknownCard))
    renderRoutes('/assistant')
    await typeAndSend('x')
    expect(await screen.findByText('新版本卡片')).toBeTruthy()
  })

  it('档案变更卡片点击进入确认页', async () => {
    server
      .on('POST', '/assistant/conversations/c1/messages', () =>
        sseBody([
          { event: 'message.start', data: { message_id: 'm1', conversation_id: 'c1' } },
          { event: 'block.card', data: { block_index: 0, card_type: 'profile_diff', payload: { extraction_id: 'e1', status: 'succeeded', count: 2, labels: ['成立年份', '核心优势'] } } },
          { event: 'message.done', data: { usage: {} } },
        ]),
      )
      .on('GET', '/extractions/e1', { id: 'e1', source: 'chat', status: 'succeeded', progress: [], changes: [{}, {}], error: '', created_at: '' })
    const { router } = renderRoutes('/assistant')
    await typeAndSend('我们 2008 年成立')
    const title = await screen.findByText('档案待确认变更')
    expect(screen.getByText('整理出 2 项变更，点击确认')).toBeTruthy()
    const button = title.closest('button')!
    fireEvent.pointerDown(button, { pointerId: 1 })
    fireEvent.pointerUp(button, { pointerId: 1 })
    await waitFor(() => expect(router.state.location.pathname).toBe('/extractions/e1/review'))
  })
})

describe('助手：渲染安全', () => {
  it('模型输出中的 HTML 与 javascript: 链接按纯文本显示', async () => {
    server.on('POST', '/assistant/conversations/c1/messages', () =>
      sseBody([
        { event: 'message.start', data: { message_id: 'm1', conversation_id: 'c1' } },
        { event: 'block.delta', data: { block_index: 0, text: '<img src=x onerror="alert(1)"> [点我](javascript:alert(1)) [官网](https://demo.example)' } },
        { event: 'message.done', data: { usage: {} } },
      ]),
    )
    renderRoutes('/assistant')
    await typeAndSend('x')
    await screen.findByText(/官网（demo.example）/)
    expect(document.querySelector('.assistant-thread img[src="x"]')).toBeNull()
    const links = Array.from(document.querySelectorAll('.assistant-thread a'))
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['https://demo.example/'])
    expect(links[0].getAttribute('rel')).toContain('noopener')
    expect(screen.getByText(/<img src=x onerror="alert\(1\)">/)).toBeTruthy()
  })
})

describe('助手：历史会话', () => {
  it('打开历史、切换会话加载消息', async () => {
    server
      .on('GET', '/assistant/conversations', [{ id: 'c9', title: '找德国客户', updated_at: '' }])
      .on('GET', '/assistant/conversations/c9/messages', [
        { id: 'u', role: 'user', blocks: [{ semanticRole: 'prompt', content: '德国阀门买家' }], state: 'completed', error_code: '', feedback: '', created_at: '' },
        { id: 'a', role: 'assistant', blocks: [{ semanticRole: 'body', content: '找到 3 家' }], state: 'completed', error_code: '', feedback: '', created_at: '' },
      ])
    const { router } = renderRoutes('/assistant')
    await screen.findByText(/你好，我是/)
    fireEvent.click(screen.getByRole('button', { name: '打开侧边栏菜单' }))
    fireEvent.click(await screen.findByText('找德国客户'))
    expect(await screen.findByText('找到 3 家')).toBeTruthy()
    expect(router.state.location.search).toBe('?c=c9')
  })
})

describe('建议任务', () => {
  it('按状态生成，最多 4 个', () => {
    expect(welcomeSuggestions({ completeness: 30, hasSite: false, hasWatch: false, newLeads: 0 })).toEqual([
      '帮我补充企业档案',
      '帮我生成英文官网',
      '帮我找海外采购商',
    ])
    expect(welcomeSuggestions({ completeness: 90, hasSite: true, hasWatch: true, newLeads: 3 })).toEqual(['看看今天的新商机'])
  })
})
