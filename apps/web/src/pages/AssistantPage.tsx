// AI 获客助手（Tab 1）：参考设计包 screens/generated/agent.tsx。
// NavBar Agent（左：历史会话；中：产品名；右：新对话）+ 消息流 + TabBar 内置 AgentInput。
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, FormSingleLine, InternalNavBarTitle, Markdown, NavBar, SettingsFullWidthItem, Snackbar } from '@yb/generated/components'
import { Icon } from '@yb/library/Icon'
import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api } from '@/api/endpoints'
import { assistantApi, type ConversationOut } from '@/assistant/api'
import { AssistantCard } from '@/assistant/cards/registry'
import { MarkdownText } from '@/assistant/MarkdownText'
import { welcomeSuggestions } from '@/assistant/suggestions'
import { plainText } from '@/assistant/turn'
import { useConversation, type ChatMessage } from '@/assistant/useConversation'
import { TabPage } from '@/components/local/TabPage'
import { ChoiceSheet, ConfirmDialog, FormSheet } from '@/feedback/overlays'
import { useToast } from '@/feedback/toast'
import { useErrorToast } from '@/feedback/useErrorToast'
import { t } from '@/i18n'
import { useSession } from '@/session/session'

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

  const suggestions = welcomeSuggestions({
    completeness: profile.data?.completeness ?? null,
    hasSite: false,
    hasWatch: false,
    newLeads: 0,
  })

  return (
    <TabPage
      input={{
        onChange: setDraft,
        onSend: () => send(draft),
        onStop: () => void chat.stop(),
        placeholder: t.assistant.inputPlaceholder,
        state: chat.generating ? 'generating' : 'idle',
        value: draft,
      }}
      nav={
        <NavBar
          barType="Agent"
          middleSlot={<InternalNavBarTitle dualTitle="False">{t.app.name}</InternalNavBarTitle>}
          onAction={(action) => {
            if (action === 'back') setHistoryOpen(true)
          }}
          primaryBg
          rightButton
          rightSlot={
            <button aria-label={t.assistant.newChat} className="yb-navbar-btn" onClick={newChat} type="button">
              <Icon name="Icon/NewChat" nodeId="3736:2797" size={24} />
            </button>
          }
        />
      }
      surface="primary"
    >
      <div className="assistant-thread" aria-live="polite">
        {chat.messages.length === 0 && !chat.loading ? (
          <div className="assistant-welcome">
            <Markdown variant="H3">{t.assistant.welcomeTitle}</Markdown>
            <Markdown variant="Body">
              <p>{t.assistant.welcomeBody}</p>
            </Markdown>
            <Markdown items={[...t.assistant.welcomeItems]} variant="UL" />
            <Markdown
              items={suggestions}
              onAction={(action) => {
                if (action.startsWith('follow-up:')) send(action.slice('follow-up:'.length))
              }}
              variant="followUp"
            />
          </div>
        ) : null}
        {chat.messages.map((message, index) => (
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
        ))}
        <div ref={bottomRef} />
      </div>
      {chat.weakNetwork ? (
        <div className="assistant-snackbar">
          <Snackbar actionButton={false} icon={false}>
            {t.assistant.weakNetwork}
          </Snackbar>
        </div>
      ) : null}
      <HistorySheet
        currentId={chat.conversationId}
        onClose={() => setHistoryOpen(false)}
        onDeleted={(id) => {
          void queryClient.invalidateQueries({ queryKey: ['assistant', 'conversations'] })
          if (id === chat.conversationId) newChat()
          toast.show(t.assistant.deleted)
        }}
        onError={showError}
        onNewChat={newChat}
        onSelect={(id) => {
          setHistoryOpen(false)
          setParams({ c: id })
        }}
        open={historyOpen}
      />
    </TabPage>
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
      <div className="assistant-turn" data-role="user">
        <Markdown variant="prompt">{message.text ?? ''}</Markdown>
      </div>
    )
  }
  const thinking = message.state === 'thinking'
  const running = message.progress.find((p) => p.status === 'running')
  const hasContent = message.blocks.some((b) => (b.semanticRole === 'body' ? b.content : true))
  const showProgress = thinking || message.progress.length > 0
  return (
    <div className="assistant-turn" data-role="assistant" data-state={message.state}>
      {showProgress ? (
        <Markdown
          body={
            message.progress.length ? (
              <span className="assistant-steps">
                {message.progress.map((p) => (
                  <span key={p.step}>{`${p.status === 'done' ? '✓' : p.status === 'failed' ? '✗' : '…'} ${p.label}${p.summary ? `：${p.summary}` : ''}`}</span>
                ))}
              </span>
            ) : undefined
          }
          variant="Progress"
          {...{ status: thinking ? 'loading' : 'done' }}
        >
          {thinking ? (running?.label ?? (hasContent ? t.assistant.working : t.assistant.thinking)) : t.assistant.done}
        </Markdown>
      ) : null}
      {message.blocks.map((block, index) => {
        if (block.semanticRole === 'card') return <AssistantCard cardType={block.card_type} key={index} payload={block.payload} />
        if (block.semanticRole === 'body' && block.content) return <MarkdownText key={index} text={block.content} />
        return null
      })}
      {message.state === 'error' || message.state === 'cancelled' ? (
        <div className="assistant-error">
          <Markdown variant="Body">
            <p>{message.state === 'cancelled' ? t.assistant.stopped : message.error?.message || t.assistant.failed}</p>
          </Markdown>
          <Button onAction={(a) => a === 'press' && onRetry()} size="S" type="Outline">
            {t.assistant.retry}
          </Button>
        </div>
      ) : null}
      {/* 规范 conversation-content-domain：建议操作在内容之后，回复级操作最后；生成中不显示完成态操作 */}
      {message.state === 'completed' && isLast && message.followups.length ? (
        <Markdown
          items={message.followups}
          onAction={(action) => {
            if (action.startsWith('follow-up:')) onFollowUp(action.slice('follow-up:'.length))
          }}
          variant="followUp"
        />
      ) : null}
      {message.state === 'completed' ? (
        <div className="assistant-toolbar">
          <Markdown
            onAction={(action) => {
              if (action === 'copy') onCopy()
              if (action === 'refresh') onRetry()
              if (action === 'like') onFeedback(message.feedback === 'like' ? '' : 'like')
              if (action === 'dislike') onFeedback(message.feedback === 'dislike' ? '' : 'dislike')
            }}
            variant="Toolbar"
          />
        </div>
      ) : null}
    </div>
  )
}

interface HistorySheetProps {
  open: boolean
  onNewChat: () => void
  currentId: string | null
  onSelect: (id: string) => void
  onClose: () => void
  onDeleted: (id: string) => void
  onError: (error: unknown) => void
}

function HistorySheet({ open, currentId, onSelect, onClose, onDeleted, onError, onNewChat }: HistorySheetProps) {
  const queryClient = useQueryClient()
  const session = useSession()
  const list = useQuery({ queryKey: ['assistant', 'conversations', session.company?.id], queryFn: assistantApi.conversations, enabled: open })
  const [menu, setMenu] = useState<ConversationOut | null>(null)
  const [renaming, setRenaming] = useState<ConversationOut | null>(null)
  const [deleting, setDeleting] = useState<ConversationOut | null>(null)
  const [title, setTitle] = useState('')

  return (
    <>
      <FormSheet
        onClose={onClose}
        onPrimary={() => {
          onClose()
          onNewChat()
        }}
        open={open && !menu && !renaming && !deleting}
        primaryLabel={t.assistant.newChat}
        secondaryLabel={t.common.cancel}
        title={t.assistant.history}
      >
        <div className="history-list">
          {list.data?.length === 0 ? (
            <Markdown variant="Body">
              <p>{t.assistant.historyEmpty}</p>
            </Markdown>
          ) : null}
          {list.data?.map((conversation) => (
            <SettingsFullWidthItem
              key={conversation.id}
              onAction={(action) => {
                if (action === 'open') onSelect(conversation.id)
                if (action === 'more') setMenu(conversation)
              }}
              trailing={conversation.id === currentId ? t.assistant.current : ' '}
              trailingKind="more"
              type="单行列表-常规"
            >
              {conversation.title || t.assistant.untitled}
            </SettingsFullWidthItem>
          ))}
        </div>
      </FormSheet>
      <ChoiceSheet
        cancelLabel={t.common.cancel}
        description={menu?.title || t.assistant.untitled}
        items={[t.assistant.rename, t.assistant.deleteConversation]}
        label={menu?.title ?? ''}
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
      />
      <FormSheet
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
        primaryLabel={t.common.save}
        secondaryLabel={t.common.cancel}
        title={t.assistant.renameTitle}
      >
        <div className="sheet-form">
          <FormSingleLine align="left" maxLength={60} onChange={setTitle} placeholder={t.assistant.untitled} value={title} />
        </div>
      </FormSheet>
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
