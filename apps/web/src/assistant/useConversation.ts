// 助手会话控制：加载历史、发送、停止、重试、弱网检测。
import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { SseEvent } from '@/api/sse'
import { useErrorToast } from '@/feedback/useErrorToast'
import { assistantApi } from './api'
import { emptyAssistant, fromStored, reduceEvent, type AssistantMessage } from './turn'

/** 生成中超过这个时间没有收到任何数据，显示弱网轻提示（规范 in-stream-weak-network）。 */
export const WEAK_NETWORK_MS = 5000

export interface ChatMessage extends AssistantMessage {
  /** 本地临时 ID（发送后、收到 message.start 前） */
  localId: string
  text?: string
}

let localSeq = 0
const nextLocal = () => `local-${++localSeq}`

export function useConversation(initialId: string | null) {
  const queryClient = useQueryClient()
  const showError = useErrorToast()
  const [conversationId, setConversationId] = useState<string | null>(initialId)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [loading, setLoading] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [weakNetwork, setWeakNetwork] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const activeRef = useRef<{ conversationId: string; messageId: string } | null>(null)
  const weakTimer = useRef<number | null>(null)

  const clearWeak = useCallback(() => {
    if (weakTimer.current !== null) window.clearTimeout(weakTimer.current)
    weakTimer.current = null
    setWeakNetwork(false)
  }, [])

  const armWeak = useCallback(() => {
    if (weakTimer.current !== null) window.clearTimeout(weakTimer.current)
    setWeakNetwork(false)
    weakTimer.current = window.setTimeout(() => setWeakNetwork(true), WEAK_NETWORK_MS)
  }, [])

  useEffect(() => () => {
    abortRef.current?.abort()
    if (weakTimer.current !== null) window.clearTimeout(weakTimer.current)
  }, [])

  const load = useCallback(
    async (id: string | null) => {
      abortRef.current?.abort()
      clearWeak()
      setGenerating(false)
      setConversationId(id)
      setMessages([])
      if (!id) return
      setLoading(true)
      try {
        const stored = await assistantApi.messages(id)
        setMessages(stored.map((m) => ({ ...fromStored(m), localId: m.id, text: textOf(m) })))
      } catch (error) {
        showError(error)
        setConversationId(null)
      } finally {
        setLoading(false)
      }
    },
    [clearWeak, showError],
  )

  const consume = useCallback(
    async (stream: AsyncGenerator<SseEvent>, localId: string, convId: string) => {
      setGenerating(true)
      armWeak()
      try {
        for await (const event of stream) {
          armWeak()
          if (event.event === 'message.start') {
            try {
              activeRef.current = { conversationId: convId, messageId: String(JSON.parse(event.data).message_id) }
            } catch {
              // 忽略
            }
          }
          setMessages((prev) => prev.map((m) => (m.localId === localId ? { ...m, ...reduceEvent(m, event) } : m)))
        }
      } catch (error) {
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          showError(error)
          setMessages((prev) =>
            prev.map((m) =>
              m.localId === localId && m.state === 'thinking'
                ? { ...m, state: 'error', error: { code: 'network', message: '', retryable: true } }
                : m,
            ),
          )
        }
      } finally {
        clearWeak()
        setGenerating(false)
        activeRef.current = null
        void queryClient.invalidateQueries({ queryKey: ['assistant', 'conversations'] })
        void queryClient.invalidateQueries({ queryKey: ['profile'] })
      }
    },
    [armWeak, clearWeak, queryClient, showError],
  )

  const send = useCallback(
    async (text: string) => {
      const value = text.trim()
      if (!value || generating) return
      let id = conversationId
      if (!id) {
        try {
          id = (await assistantApi.createConversation()).id
          setConversationId(id)
        } catch (error) {
          showError(error)
          return
        }
      }
      const userMsg: ChatMessage = {
        ...emptyAssistant(),
        role: 'user',
        state: 'completed',
        localId: nextLocal(),
        text: value,
        blocks: [{ semanticRole: 'prompt', content: value }],
      }
      const reply: ChatMessage = { ...emptyAssistant(), localId: nextLocal() }
      setMessages((prev) => [...prev, userMsg, reply])
      const controller = new AbortController()
      abortRef.current = controller
      await consume(assistantApi.send(id, value, controller.signal), reply.localId, id)
    },
    [conversationId, consume, generating, showError],
  )

  const stop = useCallback(async () => {
    const active = activeRef.current
    abortRef.current?.abort()
    setMessages((prev) =>
      prev.map((m) =>
        m.state === 'thinking' ? { ...m, state: 'cancelled', error: { code: 'cancelled', message: '', retryable: true } } : m,
      ),
    )
    if (active) {
      try {
        await assistantApi.cancel(active.conversationId, active.messageId)
      } catch {
        // 连接已断开时后端也会停止生成
      }
    }
  }, [])

  const retry = useCallback(
    async (message: ChatMessage) => {
      if (!conversationId || generating) return
      if (!message.id) {
        // 还没收到 message.start 就失败（例如断网）：后端没有这条回答，重新发送上一条用户消息
        const index = messages.findIndex((m) => m.localId === message.localId)
        const prompt = index > 0 ? messages[index - 1] : undefined
        if (prompt?.role !== 'user' || !prompt.text) return
        setMessages((prev) => prev.filter((m) => m.localId !== message.localId && m.localId !== prompt.localId))
        const reply: ChatMessage = { ...emptyAssistant(), localId: nextLocal() }
        setMessages((prev) => [...prev, prompt, reply])
        const controller = new AbortController()
        abortRef.current = controller
        await consume(assistantApi.send(conversationId, prompt.text, controller.signal), reply.localId, conversationId)
        return
      }
      setMessages((prev) => prev.map((m) => (m.localId === message.localId ? { ...m, ...emptyAssistant(m.id), localId: m.localId } : m)))
      const controller = new AbortController()
      abortRef.current = controller
      await consume(assistantApi.retry(conversationId, message.id, controller.signal), message.localId, conversationId)
    },
    [conversationId, consume, generating, messages],
  )

  const setFeedback = useCallback(
    async (message: ChatMessage, value: '' | 'like' | 'dislike') => {
      if (!conversationId || !message.id) return
      setMessages((prev) => prev.map((m) => (m.localId === message.localId ? { ...m, feedback: value } : m)))
      try {
        await assistantApi.feedback(conversationId, message.id, value)
      } catch (error) {
        showError(error)
      }
    },
    [conversationId, showError],
  )

  return { conversationId, messages, loading, generating, weakNetwork, load, send, stop, retry, setFeedback }
}

function textOf(message: { blocks: Record<string, unknown>[] }): string {
  const prompt = message.blocks.find((b) => b.semanticRole === 'prompt')
  return prompt ? String(prompt.content ?? '') : ''
}
