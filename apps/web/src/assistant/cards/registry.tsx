// 助手卡片注册表：card_type → 组件。未知 card_type 降级为纯文本说明，不渲染空白。
import { useMutation, useQuery } from '@tanstack/react-query'
import { AlertTriangle, ChevronRight, ClipboardList, PackagePlus, type LucideIcon } from 'lucide-react'
import type { ComponentType } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '@/api/endpoints'
import { useErrorToast } from '@/feedback/useErrorToast'
import { t } from '@/i18n'
import { Button, Tag, Text, useToast } from '@/ui'
import { assistantApi } from '../api'

export interface CardProps {
  payload: Record<string, unknown>
}

const str = (value: unknown) => (typeof value === 'string' ? value : value === undefined || value === null ? '' : String(value))
const list = (value: unknown) => (Array.isArray(value) ? value.map(str) : [])

function ResultCard({ title, lines, icon: Icon, onOpen }: { title: string; lines: string[]; icon: LucideIcon; onOpen?: () => void }) {
  const body = (
    <>
      <span aria-hidden className="chat-card__icon">
        <Icon size={18} />
      </span>
      <span className="chat-card__main">
        <span className="chat-card__title">{title}</span>
        {lines.filter(Boolean).map((line, index) => (
          <span className="chat-card__line" key={index}>
            {line}
          </span>
        ))}
      </span>
      {onOpen ? <ChevronRight aria-hidden className="chat-card__chevron" size={16} /> : null}
    </>
  )
  return onOpen ? (
    <button className="chat-card chat-card--link" onClick={onOpen} type="button">
      {body}
    </button>
  ) : (
    <div className="chat-card">{body}</div>
  )
}

export function ConfirmCard({ payload }: CardProps) {
  const runId = str(payload.tool_run_id)
  const toast = useToast()
  const showError = useErrorToast()
  const status = useQuery({ queryKey: ['tool-run', runId], queryFn: () => assistantApi.run(runId), enabled: Boolean(runId) })
  const decide = useMutation({
    mutationFn: (confirm: boolean) => (confirm ? assistantApi.confirmRun(runId) : assistantApi.rejectRun(runId)),
    onSuccess: (result) => {
      void status.refetch()
      if (result.status === 'succeeded') toast.show(result.summary || t.assistant.confirmDone)
      else if (result.status === 'failed') toast.show(result.error)
    },
    onError: showError,
  })
  const state = status.data?.status ?? 'pending_confirm'
  const pending = state === 'pending_confirm'
  const stateLabel: Record<string, string> = {
    succeeded: t.assistant.confirmDone,
    rejected: t.assistant.confirmRejected,
    failed: t.assistant.confirmFailed,
    expired: t.assistant.confirmExpired,
  }
  const tone = state === 'succeeded' ? 'success' : state === 'failed' ? 'danger' : 'neutral'
  return (
    <div className="chat-card chat-card--confirm assistant-confirm" data-state={state}>
      <span aria-hidden className="chat-card__icon chat-card__icon--warning">
        <AlertTriangle size={18} />
      </span>
      <div className="chat-card__main">
        <span className="chat-card__title">{str(payload.title) || t.assistant.confirmTitle}</span>
        <span className="chat-card__line">{str(payload.summary)}</span>
        {pending ? (
          <div className="chat-card__actions">
            <Button disabled={decide.isPending} onClick={() => decide.mutate(false)} size="sm" variant="outline">
              {t.common.cancel}
            </Button>
            <Button loading={decide.isPending} onClick={() => decide.mutate(true)} size="sm" variant={payload.danger ? 'danger' : 'primary'}>
              {str(payload.confirm_label) || t.common.confirm}
            </Button>
          </div>
        ) : (
          <div className="chat-card__actions">
            <Tag tone={tone}>{stateLabel[state] ?? ''}</Tag>
          </div>
        )}
      </div>
    </div>
  )
}

export function ProfileDiffCard({ payload }: CardProps) {
  const navigate = useNavigate()
  const id = str(payload.extraction_id)
  const pending = payload.status === 'pending'
  const extraction = useQuery({
    queryKey: ['extraction', id],
    queryFn: () => api.extraction(id),
    enabled: Boolean(id),
    refetchInterval: (q) => (q.state.data?.status === 'pending' || q.state.data?.status === 'running' ? 2000 : false),
  })
  const status = extraction.data?.status ?? (pending ? 'pending' : 'succeeded')
  const count = extraction.data?.changes.length ?? Number(payload.count ?? 0)
  const lines =
    status === 'succeeded'
      ? [t.assistant.diffReady(count), list(payload.labels).join('、')]
      : status === 'applied'
        ? [t.assistant.diffApplied]
        : status === 'failed'
          ? [extraction.data?.error || t.extraction.failed]
          : [pending && payload.url ? t.assistant.diffReading(str(payload.url)) : t.extraction.running]
  return (
    <ResultCard
      icon={ClipboardList}
      lines={lines}
      onOpen={() => navigate(status === 'succeeded' ? `/extractions/${id}/review` : `/extractions/${id}`)}
      title={t.assistant.diffTitle}
    />
  )
}

export function ProductDraftCard({ payload }: CardProps) {
  const navigate = useNavigate()
  const id = str(payload.extraction_id)
  return (
    <ResultCard
      icon={PackagePlus}
      lines={[[str(payload.name_cn), str(payload.category)].filter(Boolean).join(' · '), list(payload.keywords_en).join(', '), t.assistant.draftHint]}
      onOpen={() => navigate(`/extractions/${id}/review`)}
      title={`${t.assistant.draftTitle}：${str(payload.name_en)}`}
    />
  )
}

export function CompletenessCard({ payload }: CardProps) {
  const navigate = useNavigate()
  const missing = list(payload.missing)
  return (
    <ResultCard
      icon={ClipboardList}
      lines={[t.profile.completeness(Number(payload.completeness ?? 0)), missing.length ? `${t.profile.missingTitle}：${missing.join('、')}` : '']}
      onOpen={() => navigate('/me/profile')}
      title={t.profile.title}
    />
  )
}

export function UnknownCard({ payload }: CardProps) {
  return <Text tone="secondary">{str(payload.fallback_text) || t.assistant.unknownCard}</Text>
}

export const CARD_REGISTRY: Record<string, ComponentType<CardProps>> = {
  confirm: ConfirmCard,
  profile_diff: ProfileDiffCard,
  product_draft: ProductDraftCard,
  profile_completeness: CompletenessCard,
}

export function AssistantCard({ cardType, payload }: { cardType: string; payload: Record<string, unknown> }) {
  const Component = CARD_REGISTRY[cardType] ?? UnknownCard
  return <Component payload={payload} />
}
