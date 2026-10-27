// SSE（text/event-stream）增量解析器，按 WHATWG 规范处理：
// - 行结束符支持 \n、\r\n、\r（包括被拆在两个分块之间的 \r\n）
// - 以空行分隔事件；data 多行用 \n 拼接
// - 以冒号开头的行是注释（常用作心跳），忽略
// - 字段值开头的一个空格会被去掉
// - 没有 data 字段的事件不派发
// 本文件不依赖任何其他模块，便于直接用 Node 运行单元测试。

export interface SseEvent {
  event: string
  data: string
  id?: string
  retry?: number
}

export class SseParser {
  private buffer = ''
  private pendingCR = false
  private eventType = ''
  private dataLines: string[] = []
  private hasData = false
  private lastEventId: string | undefined
  private retry: number | undefined

  /** 输入一个文本分块，返回其中已完整的事件 */
  push(chunk: string): SseEvent[] {
    const out: SseEvent[] = []
    let text = chunk
    // 上一个分块以 \r 结尾时，本分块开头的 \n 属于同一个换行。
    if (this.pendingCR) {
      if (text.startsWith('\n')) text = text.slice(1)
      this.pendingCR = false
    }
    this.buffer += text

    let start = 0
    for (let i = 0; i < this.buffer.length; i++) {
      const ch = this.buffer[i]
      if (ch !== '\n' && ch !== '\r') continue
      const line = this.buffer.slice(start, i)
      if (ch === '\r') {
        if (i + 1 < this.buffer.length) {
          if (this.buffer[i + 1] === '\n') i++
        } else {
          this.pendingCR = true
        }
      }
      start = i + 1
      const event = this.processLine(line)
      if (event) out.push(event)
    }
    this.buffer = this.buffer.slice(start)
    return out
  }

  /** 流结束：规范要求丢弃未以空行结束的事件 */
  end(): SseEvent[] {
    this.buffer = ''
    this.resetEvent()
    return []
  }

  private processLine(line: string): SseEvent | null {
    if (line === '') return this.dispatch()
    if (line.startsWith(':')) return null
    const colon = line.indexOf(':')
    const field = colon === -1 ? line : line.slice(0, colon)
    let value = colon === -1 ? '' : line.slice(colon + 1)
    if (value.startsWith(' ')) value = value.slice(1)
    switch (field) {
      case 'event':
        this.eventType = value
        break
      case 'data':
        this.dataLines.push(value)
        this.hasData = true
        break
      case 'id':
        if (!value.includes('\0')) this.lastEventId = value
        break
      case 'retry':
        if (/^\d+$/.test(value)) this.retry = Number(value)
        break
      default:
        break
    }
    return null
  }

  private dispatch(): SseEvent | null {
    if (!this.hasData) {
      this.eventType = ''
      return null
    }
    const event: SseEvent = { event: this.eventType || 'message', data: this.dataLines.join('\n') }
    if (this.lastEventId !== undefined) event.id = this.lastEventId
    if (this.retry !== undefined) event.retry = this.retry
    this.resetEvent()
    return event
  }

  private resetEvent() {
    this.eventType = ''
    this.dataLines = []
    this.hasData = false
    this.retry = undefined
  }
}
