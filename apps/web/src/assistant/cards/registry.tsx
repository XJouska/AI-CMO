// 助手卡片注册表：card_type → 组件。卡片只用正式组件组合（Card Output + Button + Markdown）。
// 未知 card_type 降级为纯文本说明，不渲染空白。
import { useMutation, useQuery } from '@tanstack/react-query'
import { Button, Card, Markdown } from '@yb/generated/components'
import { Icon } from '@yb/library/Icon'
import type { ComponentType } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '@/api/endpoints'
import { useToast } from '@/feedback/toast'
import { useErrorToast } from '@/feedback/useErrorToast'
import { t } from '@/i18n'
import { assistantApi } from '../api'

export interface CardProps {
  payload: Record<string, unknown>
}

const str = (value: unknown) => (typeof value === 'string' ? value : value === undefined || value === null ? '' : String(value))
const list = (value: unknown) => (Array.isArray(value) ? value.map(str) : [])

// 图标按设计包节点 ID 引用（按名称推导的文件名不存在）
const CARD_ICON = {
  profile: { name: 'Icon/Library', nodeId: '19817:55233' },
  draft: { name: 'Icon/Edit', nodeId: '19817:55337' },
  confirm: { name: 'Icon/Warning', nodeId: '19817:55281' },
} as const

function ResultCard({ title, lines, icon, onOpen }: { title: string; lines: string[]; icon: keyof typeof CARD_ICON; onOpen?: () => void }) {
  return (
    <div className="assistant-card">
      <Card
        card="Output"
        leftSlot={<Icon decorative {...CARD_ICON[icon]} size={20} />}
        content={
          <span className="assistant-card-lines">
            {lines.filter(Boolean).map((line, index) => (
              <span key={index}>{line}</span>
            ))}
          </span>
        }
        onAction={onOpen ? (action) => action === 'press-end' && onOpen() : undefined}
      >
        {title}
      </Card>
    </div>
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
  return (
    <div className="assistant-card assistant-confirm" data-state={state}>
      <Card card="Output" content={<span>{str(payload.summary)}</span>} leftSlot={<Icon decorative {...CARD_ICON.confirm} size={20} />}>
        {str(payload.title) || t.assistant.confirmTitle}
      </Card>
      {pending ? (
        <div className="assistant-card-actions">
          <Button onAction={(a) => a === 'press' && !decide.isPending && decide.mutate(false)} size="M" state={decide.isPending ? 'Disable' : 'Default'} type="Secondary">
            {t.common.cancel}
          </Button>
          <Button
            onAction={(a) => a === 'press' && !decide.isPending && decide.mutate(true)}
            size="M"
            state={decide.isPending ? 'Disable' : 'Default'}
            type={payload.danger ? 'Alert' : 'Primary'}
          >
            {str(payload.confirm_label) || t.common.confirm}
          </Button>
        </div>
      ) : (
        <Markdown variant="Body">
          <p>{stateLabel[state] ?? ''}</p>
        </Markdown>
      )}
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
      lines={lines}
      icon="profile"
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
      lines={[[str(payload.name_cn), str(payload.category)].filter(Boolean).join(' · '), list(payload.keywords_en).join(', '), t.assistant.draftHint]}
      icon="draft"
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
      lines={[t.profile.completeness(Number(payload.completeness ?? 0)), missing.length ? `${t.profile.missingTitle}：${missing.join('、')}` : '']}
      icon="profile"
      onOpen={() => navigate('/me/profile')}
      title={t.profile.title}
    />
  )
}

export function UnknownCard({ payload }: CardProps) {
  return (
    <Markdown variant="Body">
      <p>{str(payload.fallback_text) || t.assistant.unknownCard}</p>
    </Markdown>
  )
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
