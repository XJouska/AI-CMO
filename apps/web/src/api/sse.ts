// 基于 fetch + ReadableStream 的 SSE 客户端。
// 不使用浏览器 EventSource，因为它不能携带 Authorization 头，也不支持 POST。
import { apiRequest, type RequestOptions } from './client'
import { SseParser, type SseEvent } from './sse-parser'

export type { SseEvent } from './sse-parser'

/**
 * 发起流式请求并逐条产出事件。调用方通过 options.signal 取消。
 *
 * 用法：
 *   for await (const ev of streamSse('/chat/stream', { method: 'POST', body, signal })) { ... }
 */
export async function* streamSse(path: string, options: RequestOptions = {}): AsyncGenerator<SseEvent> {
  const headers = new Headers(options.headers)
  headers.set('Accept', 'text/event-stream')
  const response = await apiRequest(path, { method: 'POST', ...options, headers })
  if (!response.body) return

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
  const parser = new SseParser()
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      for (const event of parser.push(value)) yield event
    }
    parser.end()
  } finally {
    // 调用方提前退出循环或取消时释放连接。
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}
