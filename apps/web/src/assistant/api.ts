// 助手接口。
import { apiFetch } from '@/api/client'
import { streamSse } from '@/api/sse'

export interface ConversationOut {
  id: string
  title: string
  updated_at: string
}

export interface StoredMessage {
  id: string
  role: 'user' | 'assistant'
  blocks: Record<string, unknown>[]
  state: string
  error_code: string
  feedback: string
  created_at: string
}

export interface ToolRunOut {
  id: string
  tool_name: string
  status: string
  summary: string
  error: string
}

const base = '/assistant/conversations'

export const assistantApi = {
  conversations: () => apiFetch<ConversationOut[]>(base),
  createConversation: () => apiFetch<ConversationOut>(base, { method: 'POST', body: {} }),
  renameConversation: (id: string, title: string) => apiFetch<ConversationOut>(`${base}/${id}`, { method: 'PATCH', body: { title } }),
  deleteConversation: (id: string) => apiFetch<void>(`${base}/${id}`, { method: 'DELETE' }),
  messages: (id: string) => apiFetch<StoredMessage[]>(`${base}/${id}/messages`),
  send: (id: string, text: string, signal: AbortSignal) =>
    streamSse(`${base}/${id}/messages`, { method: 'POST', body: { text }, signal }),
  retry: (id: string, messageId: string, signal: AbortSignal) =>
    streamSse(`${base}/${id}/messages/${messageId}/retry`, { method: 'POST', signal }),
  cancel: (id: string, messageId: string) => apiFetch<StoredMessage>(`${base}/${id}/messages/${messageId}/cancel`, { method: 'POST' }),
  feedback: (id: string, messageId: string, value: '' | 'like' | 'dislike') =>
    apiFetch<void>(`${base}/${id}/messages/${messageId}/feedback`, { method: 'POST', body: { value } }),
  confirmRun: (runId: string) => apiFetch<ToolRunOut>(`/assistant/tool-runs/${runId}/confirm`, { method: 'POST' }),
  rejectRun: (runId: string) => apiFetch<ToolRunOut>(`/assistant/tool-runs/${runId}/reject`, { method: 'POST' }),
  run: (runId: string) => apiFetch<ToolRunOut>(`/assistant/tool-runs/${runId}`),
}
