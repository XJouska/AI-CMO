// 组件测试用的假后端：拦截 fetch，按「方法 + 路径」返回预设响应，并记录请求。
import { vi } from 'vitest'

type Handler = (request: { method: string; path: string; body: unknown; headers: Headers; signal?: AbortSignal | null }) => unknown

export interface FakeRoute {
  method: string
  path: string | RegExp
  status?: number
  handler: Handler | unknown
}

export interface FakeServer {
  routes: FakeRoute[]
  calls: { method: string; path: string; body: unknown; headers: Headers }[]
  on: (method: string, path: string | RegExp, handler: Handler | unknown, status?: number) => FakeServer
}

export function installFakeServer(): FakeServer {
  const server: FakeServer = {
    routes: [],
    calls: [],
    on(method, path, handler, status = 200) {
      server.routes.unshift({ method, path, handler, status })
      return server
    },
  }
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === 'string' ? input : input.toString(), 'http://localhost')
      const method = (init?.method ?? 'GET').toUpperCase()
      const path = url.pathname.replace(/^\/api\/v1/, '') + url.search
      let body: unknown = init?.body
      if (typeof body === 'string') {
        try {
          body = JSON.parse(body)
        } catch {
          // 非 JSON 原样保留
        }
      }
      const headers = new Headers(init?.headers)
      server.calls.push({ method, path, body, headers })
      const route = server.routes.find(
        (r) => r.method === method && (typeof r.path === 'string' ? r.path === path : r.path.test(path)),
      )
      if (!route) return json(404, { error: { code: 'not_found', message: '' } })
      const payload =
        typeof route.handler === 'function' ? (route.handler as Handler)({ method, path, body, headers, signal: init?.signal }) : route.handler
      if (payload instanceof Response) return payload
      if (route.status === 204) return new Response(null, { status: 204 })
      return json(route.status ?? 200, payload)
    }),
  )
  return server
}

function json(status: number, payload: unknown) {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } })
}

/** 把事件列表编码为 SSE 响应体（与后端 app/modules/assistant/sse.py 的编码一致）。 */
export function sseBody(events: { event: string; data: unknown }[]): Response {
  const text = events.map((e) => `event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`).join('')
  return new Response(text, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
}

/** 一个不会自行结束的 SSE 响应：先推送给定事件，然后保持连接直到被取消。用于测试「生成中」状态。 */
export function hangingSse(events: { event: string; data: unknown }[], signal?: AbortSignal | null): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const e of events) controller.enqueue(encoder.encode(`event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`))
      signal?.addEventListener('abort', () => controller.error(new DOMException('aborted', 'AbortError')))
    },
  })
  return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
}

export const DEMO_USER = {
  id: 'u1',
  email: 'boss@factory.com',
  name: '王总',
  is_staff: false,
  companies: [{ id: 'c1', name_cn: '宁波阀门厂', name_en: '', role: 'owner' as const }],
}

export function demoProfile(overrides: Record<string, unknown> = {}) {
  return {
    company_id: 'c1',
    name_cn: '宁波阀门厂',
    name_en: '',
    founded_year: null,
    employees: '',
    factory_area: '',
    annual_capacity: '',
    export_markets: [],
    certifications: [],
    main_customers_public: [],
    usp: '',
    about_en: '',
    contacts: {},
    field_sources: {},
    completeness: 0,
    missing: [{ key: 'usp', label: '核心优势', weight: 8, section: 'story' }],
    product_count: 0,
    ...overrides,
  }
}

export function signedIn(user = DEMO_USER) {
  window.localStorage.setItem('aicmo.token', 'test-token')
  window.localStorage.setItem('aicmo.company', user.companies[0]?.id ?? '')
}
