// 后端统一错误格式：{ "error": { "code": "...", "message": "..." } }
// 本文件不依赖路径别名，便于直接用 Node 运行单元测试。

export class ApiError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

export interface ErrorMessages {
  network: string
  unauthorized: string
  forbidden: string
  notFound: string
  rateLimited: string
  server: string
  unknown: string
}

// 通用错误码使用前端固定文案；其他业务错误码（如 invalid_credentials、account_locked）
// 的 message 由后端按面向用户的中文编写，直接展示。5xx 永远不展示后端内容。
const GENERIC_CODES = new Set([
  'unauthorized',
  'forbidden',
  'not_found',
  'rate_limited',
  'bad_request',
  'validation_error',
  'internal_error',
  'network_error',
])

/** 把任意错误转换为可以直接放进 Toast 的中文文案。 */
export function errorToMessage(error: unknown, messages: ErrorMessages): string {
  if (!(error instanceof ApiError)) return messages.unknown
  if (error.status === 0) return messages.network
  if (error.status >= 500) return messages.server
  const specific = !GENERIC_CODES.has(error.code) && !error.code.startsWith('http_') && error.message
  if (specific) return error.message
  if (error.status === 401) return messages.unauthorized
  if (error.status === 403) return messages.forbidden
  if (error.status === 404) return messages.notFound
  if (error.status === 429) return messages.rateLimited
  return error.message || messages.unknown
}

/** 解析响应体中的统一错误格式；格式不符时回退为通用错误码。 */
export async function readApiError(response: Response): Promise<ApiError> {
  let code = `http_${response.status}`
  let message = ''
  try {
    const body: unknown = await response.json()
    if (body && typeof body === 'object' && 'error' in body) {
      const err = (body as { error: unknown }).error
      if (err && typeof err === 'object') {
        const e = err as { code?: unknown; message?: unknown }
        if (typeof e.code === 'string') code = e.code
        if (typeof e.message === 'string') message = e.message
      }
    }
  } catch {
    // 响应体不是 JSON，保留默认值。
  }
  return new ApiError(response.status, code, message)
}
