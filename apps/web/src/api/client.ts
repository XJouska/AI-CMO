// 基于 fetch 的请求封装。
// - 自动携带 Authorization: Bearer <token>
// - 401 时调用注册的回调（由应用跳转到登录页）
// - 非 2xx 响应统一抛出 ApiError，界面层用 errorToMessage() 转成 Toast 文案
import { ApiError, readApiError } from './errors'

export { ApiError, errorToMessage } from './errors'

export const API_BASE = '/api/v1'

type TokenGetter = () => string | null
type UnauthorizedHandler = () => void

let getToken: TokenGetter = () => null
let onUnauthorized: UnauthorizedHandler = () => {}

export function configureApi(options: { getToken?: TokenGetter; onUnauthorized?: UnauthorizedHandler }) {
  if (options.getToken) getToken = options.getToken
  if (options.onUnauthorized) onUnauthorized = options.onUnauthorized
}

export interface RequestOptions extends Omit<RequestInit, 'body'> {
  /** 对象会序列化为 JSON；FormData / Blob / string 原样发送 */
  body?: unknown
}

export function buildHeaders(init?: HeadersInit, json = false): Headers {
  const headers = new Headers(init)
  const token = getToken()
  if (token) headers.set('Authorization', `Bearer ${token}`)
  if (json && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  if (!headers.has('Accept')) headers.set('Accept', 'application/json')
  return headers
}

function encodeBody(body: unknown): { body: BodyInit | undefined; json: boolean } {
  if (body === undefined || body === null) return { body: undefined, json: false }
  if (typeof body === 'string' || body instanceof FormData || body instanceof Blob || body instanceof URLSearchParams) {
    return { body, json: false }
  }
  return { body: JSON.stringify(body), json: true }
}

/** 发送请求并返回原始 Response；非 2xx 抛出 ApiError。供 apiFetch 和 SSE 共用。 */
export async function apiRequest(path: string, options: RequestOptions = {}): Promise<Response> {
  const { body: rawBody, headers: rawHeaders, ...rest } = options
  const { body, json } = encodeBody(rawBody)
  let response: Response
  try {
    response = await fetch(`${API_BASE}${path}`, {
      credentials: 'same-origin',
      ...rest,
      body,
      headers: buildHeaders(rawHeaders, json),
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new ApiError(0, 'network_error', '')
  }
  if (response.status === 401) onUnauthorized()
  if (!response.ok) throw await readApiError(response)
  return response
}

/** JSON 请求。204 响应返回 undefined。 */
export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const response = await apiRequest(path, options)
  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}
