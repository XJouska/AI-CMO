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

/** 把任意错误转换为可以直接放进 Toast 的中文文案。后端给出的 message 只用于已知的业务错误码。 */
export function errorToMessage(error: unknown, messages: ErrorMessages): string {
  if (!(error instanceof ApiError)) return messages.unknown
  if (error.status === 0) return messages.network
  if (error.status === 401) return messages.unauthorized
  if (error.status === 403) return messages.forbidden
  if (error.status === 404) return messages.notFound
  if (error.status === 429) return messages.rateLimited
  if (error.status >= 500) return messages.server
  // 4xx 业务错误：后端返回的 message 面向用户，直接展示。
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
