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

/** 运营人员代操作某家企业（AI 助手、网站编辑、找买家设置等工具只对运营开放）。 */
export const OPERATOR_USER = {
  ...DEMO_USER,
  email: 'ops@aicmo.site',
  name: '运营小李',
  is_staff: true,
  companies: [{ id: 'c1', name_cn: '宁波阀门厂', name_en: '', role: 'operator' as const }],
}

const CATEGORIES = [
  { key: 'factory_photo', label: '工厂和车间照片', required: true, images_only: true },
  { key: 'product_photo', label: '产品照片', required: true, images_only: true },
  { key: 'catalog', label: '产品目录或说明书', required: false, images_only: false },
  { key: 'certificate', label: '证书', required: false, images_only: false },
  { key: 'business_card', label: '名片', required: true, images_only: false },
  { key: 'logo', label: 'Logo', required: false, images_only: true },
]

const STAGE_KEYS = ['materials', 'building', 'review', 'live', 'buyers'] as const
const STAGE_LABELS = ['资料已收到', '网站制作中', '网站待你确认', '网站已上线', '正在找买家']

/** 客户服务进度（/service/overview）。 */
export function demoOverview(overrides: Record<string, unknown> = {}) {
  const stage = (overrides.stage as string) ?? 'materials'
  const current = STAGE_KEYS.indexOf(stage as (typeof STAGE_KEYS)[number])
  return {
    stage,
    stages: STAGE_KEYS.map((key, i) => ({ key, label: STAGE_LABELS[i], state: i < current ? 'done' : i === current ? 'current' : 'todo' })),
    next: { title: '资料已收到，我们正在整理', body: '我们正在用 AI 做你的英文网站，大约 2 小时做好，做好后通知你。', action: '', link: '' },
    materials: {},
    missing: [],
    categories: CATEGORIES,
    style_choice: 'heavy',
    site_url: '',
    week: { buyers_week: 0, buyers_total: 0, inquiries_week: 0 },
    build_hours: 2,
    submitted: true,
    revising: false,
    ...overrides,
  }
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
