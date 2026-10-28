// AI 获客助手：桌面左侧为历史会话栏（宽屏常驻，窄屏用抽屉），右侧为对话区 + 底部输入框。
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowUp, Copy, History, MessageSquarePlus, MoreHorizontal, RotateCcw, Sparkles, Square, ThumbsDown, ThumbsUp, WifiOff } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api } from '@/api/endpoints'
import { assistantApi, type ConversationOut } from '@/assistant/api'
import { AssistantCard } from '@/assistant/cards/registry'
import { MarkdownText } from '@/assistant/MarkdownText'
import { welcomeSuggestions } from '@/assistant/suggestions'
import { plainText } from '@/assistant/turn'
import { useConversation, type ChatMessage } from '@/assistant/useConversation'
import { StepProgress } from '@/components/StepProgress'
import { useErrorToast } from '@/feedback/useErrorToast'
import { t } from '@/i18n'
import { AppPage } from '@/layout/AppPage'
import { useSession } from '@/session/session'
import { Button, ChoiceMenu, ConfirmDialog, cx, Drawer, FormModal, IconButton, Spinner, TextField, useToast } from '@/ui'

export function AssistantPage() {
  const toast = useToast()
  const session = useSession()
  const queryClient = useQueryClient()
  const showError = useErrorToast()
  const [params, setParams] = useSearchParams()
  const chat = useConversation(null)
  const [draft, setDraft] = useState('')
  const [historyOpen, setHistoryOpen] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const profile = useQuery({ queryKey: ['profile', session.company?.id], queryFn: api.profile })

  const urlConversation = params.get('c')
  useEffect(() => {
    if (urlConversation !== chat.conversationId) void chat.load(urlConversation)
    // 只在地址栏中的会话变化时加载
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlConversation])

  useEffect(() => {
    if (chat.conversationId && chat.conversationId !== urlConversation) setParams({ c: chat.conversationId }, { replace: true })
  }, [chat.conversationId, urlConversation, setParams])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [chat.messages])

  const send = (text: string) => {
    if (!text.trim() || chat.generating) return
    setDraft('')
    void chat.send(text)
  }

  const newChat = () => {
    if (chat.generating) void chat.stop()
    setParams({}, { replace: false })
    void chat.load(null)
  }

  const selectConversation = (id: string) => {
    setHistoryOpen(false)
    setParams({ c: id })
  }

  const suggestions = welcomeSuggestions({
    completeness: profile.data?.completeness ?? null,
    hasSite: false,
    hasWatch: false,
    newLeads: 0,
  })

  const historyProps = {
    currentId: chat.conversationId,
    onDeleted: (id: string) => {
      void queryClient.invalidateQueries({ queryKey: ['assistant', 'conversations'] })
      if (id === chat.conversationId) newChat()
      toast.show(t.assistant.deleted)
    },
    onError: showError,
    onSelect: selectConversation,
  }

  const empty = chat.messages.length === 0 && !chat.loading

  return (
    <AppPage
      actions={
        <>
          <IconButton className="chat-history-toggle" icon={History} label={t.assistant.history} onClick={() => setHistoryOpen(true)} />
          <Button aria-label={t.assistant.newChat} icon={MessageSquarePlus} onClick={newChat} variant="outline">
            {t.assistant.newChat}
          </Button>
        </>
      }
      className="chat-page"
      title={t.tabs.assistant}
      width="full"
    >
      <div className="chat">
        <aside className="chat-history">
          <div className="chat-history__head">{t.assistant.history}</div>
          <HistoryList {...historyProps} enabled />
        </aside>
        <section className="chat-main">
          <div aria-live="polite" className={cx('chat-thread assistant-thread', empty && 'is-empty')}>
            {empty ? (
              <Welcome onSend={send} suggestions={suggestions} />
            ) : (
              chat.messages.map((message, index) => (
                <MessageView
                  isLast={index === chat.messages.length - 1}
                  key={message.localId}
                  message={message}
                  onCopy={() => {
                    void navigator.clipboard?.writeText(plainText(message)).then(() => toast.show(t.assistant.copied), () => {})
                  }}
                  onFeedback={(value) => void chat.setFeedback(message, value)}
                  onFollowUp={send}
                  onRetry={() => void chat.retry(message)}
                />
              ))
            )}
            {chat.loading ? <Spinner label={t.common.loading} /> : null}
            <div ref={bottomRef} />
          </div>
          <div className="chat-composer-wrap">
            {chat.weakNetwork ? (
              <div className="chat-weak" role="status">
                <WifiOff aria-hidden size={14} />
                {t.assistant.weakNetwork}
              </div>
            ) : null}
            <Composer
              generating={chat.generating}
              onChange={setDraft}
              onSend={() => send(draft)}
              onStop={() => void chat.stop()}
              value={draft}
            />
            <p className="chat-disclaimer">{t.assistant.disclaimer}</p>
          </div>
        </section>
      </div>
      <Drawer label={t.assistant.history} onClose={() => setHistoryOpen(false)} open={historyOpen} side="left" title={t.assistant.history}>
        <HistoryList {...historyProps} enabled={historyOpen} />
      </Drawer>
    </AppPage>
  )
}

function Welcome({ suggestions, onSend }: { suggestions: string[]; onSend: (text: string) => void }) {
  return (
    <div className="chat-welcome assistant-welcome">
      <span aria-hidden className="chat-welcome__icon">
        <Sparkles size={22} />
      </span>
      <h2 className="chat-welcome__title">{t.assistant.welcomeTitle}</h2>
      <p className="chat-welcome__body">{t.assistant.welcomeBody}</p>
      <ul className="chat-welcome__list">
        {t.assistant.welcomeItems.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
      {suggestions.length ? (
        <div className="chat-suggestions">
          {suggestions.map((item) => (
            <button className="chat-suggestion" key={item} onClick={() => onSend(item)} type="button">
              {item}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

interface ComposerProps {
  value: string
  onChange: (value: string) => void
  onSend: () => void
  onStop: () => void
  generating: boolean
}

/** 自适应高度输入框：Enter 发送，Shift+Enter 换行；生成中显示停止按钮。 */
function Composer({ value, onChange, onSend, onStop, generating }: ComposerProps) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
  }, [value])

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      if (!generating) onSend()
    }
  }

  return (
    <div className="chat-composer">
      <textarea
        aria-label={t.assistant.inputLabel}
        className="chat-composer__input"
        maxLength={4000}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder={t.assistant.inputPlaceholder}
        ref={ref}
        rows={1}
        value={value}
      />
      {generating ? (
        <IconButton icon={Square} label={t.assistant.stop} onClick={onStop} variant="primary" />
      ) : (
        <IconButton disabled={!value.trim()} icon={ArrowUp} label={t.assistant.send} onClick={onSend} variant="primary" />
      )}
    </div>
  )
}

interface MessageViewProps {
  message: ChatMessage
  isLast: boolean
  onRetry: () => void
  onFollowUp: (text: string) => void
  onCopy: () => void
  onFeedback: (value: '' | 'like' | 'dislike') => void
}

function MessageView({ message, isLast, onRetry, onFollowUp, onCopy, onFeedback }: MessageViewProps) {
  if (message.role === 'user') {
    return (
      <div className="chat-turn chat-turn--user" data-role="user">
        <div className="chat-bubble">{message.text ?? ''}</div>
      </div>
    )
  }
  const thinking = message.state === 'thinking'
  const running = message.progress.find((p) => p.status === 'running')
  const hasContent = message.blocks.some((b) => (b.semanticRole === 'body' ? b.content : true))
  const showProgress = thinking || message.progress.length > 0
  return (
    <div className="chat-turn chat-turn--assistant" data-role="assistant" data-state={message.state}>
      <span aria-hidden className="chat-avatar">
        <Sparkles size={16} />
      </span>
      <div className="chat-answer">
        {showProgress ? (
          <StepProgress
            running={thinking}
            steps={message.progress.map((p) => ({ key: String(p.step), label: `${p.label}${p.summary ? `：${p.summary}` : ''}`, status: p.status }))}
            title={thinking ? (running?.label ?? (hasContent ? t.assistant.working : t.assistant.thinking)) : t.assistant.done}
          />
        ) : null}
        {message.blocks.map((block, index) => {
          if (block.semanticRole === 'card') return <AssistantCard cardType={block.card_type} key={index} payload={block.payload} />
          if (block.semanticRole === 'body' && block.content) return <MarkdownText key={index} text={block.content} />
          return null
        })}
        {message.state === 'error' || message.state === 'cancelled' ? (
          <div className="chat-error">
            <span>{message.state === 'cancelled' ? t.assistant.stopped : message.error?.message || t.assistant.failed}</span>
            <Button icon={RotateCcw} onClick={onRetry} size="sm" variant="outline">
              {t.assistant.retry}
            </Button>
          </div>
        ) : null}
        {/* 建议操作在内容之后，回复级操作最后；生成中不显示完成态操作 */}
        {message.state === 'completed' && isLast && message.followups.length ? (
          <div className="chat-suggestions chat-suggestions--inline">
            {message.followups.map((item) => (
              <button className="chat-suggestion" key={item} onClick={() => onFollowUp(item)} type="button">
                {item}
              </button>
            ))}
          </div>
        ) : null}
        {message.state === 'completed' ? (
          <div className="chat-toolbar assistant-toolbar">
            <IconButton icon={Copy} label={t.common.copy} onClick={onCopy} size="sm" />
            <IconButton icon={RotateCcw} label={t.assistant.regenerate} onClick={onRetry} size="sm" />
            <IconButton active={message.feedback === 'like'} icon={ThumbsUp} label={t.assistant.like} onClick={() => onFeedback(message.feedback === 'like' ? '' : 'like')} size="sm" />
            <IconButton active={message.feedback === 'dislike'} icon={ThumbsDown} label={t.assistant.dislike} onClick={() => onFeedback(message.feedback === 'dislike' ? '' : 'dislike')} size="sm" />
          </div>
        ) : null}
      </div>
    </div>
  )
}

interface HistoryListProps {
  enabled: boolean
  currentId: string | null
  onSelect: (id: string) => void
  onDeleted: (id: string) => void
  onError: (error: unknown) => void
}

function HistoryList({ enabled, currentId, onSelect, onDeleted, onError }: HistoryListProps) {
  const queryClient = useQueryClient()
  const session = useSession()
  const list = useQuery({ queryKey: ['assistant', 'conversations', session.company?.id], queryFn: assistantApi.conversations, enabled })
  const [menu, setMenu] = useState<ConversationOut | null>(null)
  const [renaming, setRenaming] = useState<ConversationOut | null>(null)
  const [deleting, setDeleting] = useState<ConversationOut | null>(null)
  const [title, setTitle] = useState('')

  return (
    <>
      <div className="chat-history__list">
        {list.isPending && enabled ? <Spinner /> : null}
        {list.data?.length === 0 ? <p className="chat-history__empty">{t.assistant.historyEmpty}</p> : null}
        {list.data?.map((conversation) => (
          <div className={cx('chat-history__item', conversation.id === currentId && 'is-active')} key={conversation.id}>
            <button aria-current={conversation.id === currentId || undefined} className="chat-history__open" onClick={() => onSelect(conversation.id)} type="button">
              {conversation.title || t.assistant.untitled}
            </button>
            <IconButton className="chat-history__more" icon={MoreHorizontal} label={t.assistant.more} onClick={() => setMenu(conversation)} size="sm" />
          </div>
        ))}
      </div>
      <ChoiceMenu
        cancelLabel={t.common.cancel}
        description={menu?.title || t.assistant.untitled}
        items={[{ label: t.assistant.rename }, { label: t.assistant.deleteConversation, danger: true }]}
        onCancel={() => setMenu(null)}
        onSelect={(index) => {
          const target = menu
          setMenu(null)
          if (!target) return
          if (index === 0) {
            setTitle(target.title)
            setRenaming(target)
          } else setDeleting(target)
        }}
        open={menu !== null}
        title={t.assistant.conversationMenu}
      />
      <FormModal
        onClose={() => setRenaming(null)}
        onPrimary={async () => {
          const target = renaming
          setRenaming(null)
          if (!target || !title.trim()) return
          try {
            await assistantApi.renameConversation(target.id, title.trim())
            await queryClient.invalidateQueries({ queryKey: ['assistant', 'conversations'] })
          } catch (error) {
            onError(error)
          }
        }}
        open={renaming !== null}
        primaryDisabled={!title.trim()}
        primaryLabel={t.common.save}
        secondaryLabel={t.common.cancel}
        title={t.assistant.renameTitle}
      >
        <TextField maxLength={60} onChange={setTitle} placeholder={t.assistant.untitled} value={title} />
      </FormModal>
      <ConfirmDialog
        cancelLabel={t.common.cancel}
        confirmLabel={t.common.delete}
        danger
        onCancel={() => setDeleting(null)}
        onConfirm={async () => {
          const target = deleting
          setDeleting(null)
          if (!target) return
          try {
            await assistantApi.deleteConversation(target.id)
            onDeleted(target.id)
          } catch (error) {
            onError(error)
          }
        }}
        open={deleting !== null}
        title={t.assistant.deleteConfirm}
      />
    </>
  )
}
