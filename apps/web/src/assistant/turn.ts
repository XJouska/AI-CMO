// 助手回答的状态机：把 SSE 事件归并为一条消息的显示模型。纯函数，前后端共享 contracts/sse-assistant.json 测试。

export type TurnState = 'thinking' | 'completed' | 'error' | 'cancelled'

export interface ProgressStep {
  step: number
  label: string
  status: 'running' | 'done' | 'failed'
  summary?: string
}

export type Block =
  | { semanticRole: 'body'; content: string }
  | { semanticRole: 'card'; card_type: string; payload: Record<string, unknown> }
  | { semanticRole: 'followUp'; items: string[] }
  | { semanticRole: 'prompt'; content: string }

export interface AssistantMessage {
  id: string
  role: 'user' | 'assistant'
  state: TurnState
  blocks: Block[]
  progress: ProgressStep[]
  followups: string[]
  error: { code: string; message: string; retryable: boolean } | null
  feedback: '' | 'like' | 'dislike'
}

export interface SseEventLike {
  event: string
  data: string | Record<string, unknown>
}

export function emptyAssistant(id = ''): AssistantMessage {
  return { id, role: 'assistant', state: 'thinking', blocks: [], progress: [], followups: [], error: null, feedback: '' }
}

function payload(event: SseEventLike): Record<string, unknown> {
  if (typeof event.data !== 'string') return event.data
  try {
    const parsed: unknown = JSON.parse(event.data)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

function setBlock(blocks: Block[], index: number, block: Block): Block[] {
  const next = blocks.slice()
  while (next.length < index) next.push({ semanticRole: 'body', content: '' })
  next[index] = block
  return next
}

/** 归并一个事件。未知事件忽略（向前兼容）。只追加当前块，不重建已稳定的内容。 */
export function reduceEvent(message: AssistantMessage, event: SseEventLike): AssistantMessage {
  const data = payload(event)
  switch (event.event) {
    case 'message.start':
      return { ...emptyAssistant(String(data.message_id ?? message.id)), feedback: message.feedback }
    case 'progress': {
      const step: ProgressStep = {
        step: Number(data.step),
        label: String(data.label ?? ''),
        status: (data.status as ProgressStep['status']) ?? 'running',
        ...(typeof data.summary === 'string' ? { summary: data.summary } : {}),
      }
      const existing = message.progress.findIndex((p) => p.step === step.step)
      const progress = existing >= 0 ? message.progress.map((p, i) => (i === existing ? step : p)) : [...message.progress, step]
      return { ...message, progress }
    }
    case 'block.delta': {
      const index = Number(data.block_index)
      const current = message.blocks[index]
      const before = current && current.semanticRole === 'body' ? current.content : ''
      return { ...message, blocks: setBlock(message.blocks, index, { semanticRole: 'body', content: before + String(data.text ?? '') }) }
    }
    case 'block.card': {
      const index = Number(data.block_index)
      const card: Block = {
        semanticRole: 'card',
        card_type: String(data.card_type ?? ''),
        payload: (data.payload as Record<string, unknown>) ?? {},
      }
      return { ...message, blocks: setBlock(message.blocks, index, card) }
    }
    case 'followups':
      return { ...message, followups: Array.isArray(data.items) ? data.items.map(String) : [] }
    case 'message.done':
      return { ...message, state: 'completed' }
    case 'error': {
      const code = String(data.code ?? 'error')
      return {
        ...message,
        state: code === 'cancelled' ? 'cancelled' : 'error',
        error: { code, message: String(data.message ?? ''), retryable: Boolean(data.retryable) },
      }
    }
    default:
      return message
  }
}

/** 后端保存的消息（GET messages）转换为显示模型。 */
export function fromStored(stored: {
  id: string
  role: string
  blocks: Record<string, unknown>[]
  state: string
  error_code: string
  feedback: string
}): AssistantMessage {
  const blocks: Block[] = []
  let followups: string[] = []
  for (const raw of stored.blocks) {
    if (raw.semanticRole === 'followUp') followups = Array.isArray(raw.items) ? raw.items.map(String) : []
    else if (raw.semanticRole === 'card') {
      blocks.push({ semanticRole: 'card', card_type: String(raw.card_type ?? ''), payload: (raw.payload as Record<string, unknown>) ?? {} })
    } else blocks.push({ semanticRole: raw.semanticRole === 'prompt' ? 'prompt' : 'body', content: String(raw.content ?? '') })
  }
  const state = (['thinking', 'completed', 'error', 'cancelled'].includes(stored.state) ? stored.state : 'completed') as TurnState
  return {
    id: stored.id,
    role: stored.role === 'user' ? 'user' : 'assistant',
    state,
    blocks,
    progress: [],
    followups,
    error: state === 'error' ? { code: stored.error_code, message: '', retryable: true } : null,
    feedback: stored.feedback === 'like' || stored.feedback === 'dislike' ? stored.feedback : '',
  }
}

export function plainText(message: AssistantMessage): string {
  return message.blocks
    .filter((b): b is Extract<Block, { semanticRole: 'body' }> => b.semanticRole === 'body')
    .map((b) => b.content)
    .join('\n\n')
    .trim()
}
