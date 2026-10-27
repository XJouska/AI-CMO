// AI 抽取进度页与确认变更页。
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, EmptyPage, FormDoubleLine, ListSectionTitle, Markdown, RadioCheckBox, SettingsFullWidthItem } from '@yb/generated/components'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { api, type ChangeGroup, type Extraction, type ExtractionChange } from '@/api/endpoints'
import { QueryView } from '@/components/local/QueryView'
import { PageCenter, StackPage } from '@/components/local/StackPage'
import { FormSheet } from '@/feedback/overlays'
import { useToast } from '@/feedback/toast'
import { useErrorToast } from '@/feedback/useErrorToast'
import { t } from '@/i18n'
import { describeValue, editableText, parseEdited } from './changes'

const POLL_MS = 1500

export function ExtractionProgressPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const query = useQuery({
    queryKey: ['extraction', id],
    queryFn: () => api.extraction(id),
    refetchInterval: (q) => {
      const status = q.state.data?.status
      return status === 'pending' || status === 'running' ? POLL_MS : false
    },
  })
  const status = query.data?.status

  useEffect(() => {
    if (status === 'succeeded') navigate(`/extractions/${id}/review`, { replace: true })
    if (status === 'applied') navigate('/me/profile', { replace: true })
  }, [status, id, navigate])

  useEffect(() => {
    if (status === 'failed' && query.data?.error) toast.show(query.data.error)
  }, [status, query.data?.error, toast])

  return (
    <StackPage backTo="/onboarding" surface="primary" title={t.extraction.title}>
      <QueryView query={query}>
        {(extraction) =>
          extraction.status === 'failed' ? (
            <PageCenter>
              <EmptyPage
                buttonLabel={t.extraction.retry}
                descText={extraction.error}
                illus="networkError"
                onAction={(action) => action === 'press' && navigate('/onboarding', { replace: true })}
              >
                {t.extraction.failed}
              </EmptyPage>
            </PageCenter>
          ) : (
            <div className="content-inset">
              {/* status 不在生成的类型声明中，按设计包示例（agent.tsx）的写法通过展开传入 */}
              <Markdown variant="Progress" {...{ status: progressStatus(extraction) }}>
                {extraction.status === 'succeeded' ? t.extraction.done : t.extraction.running}
              </Markdown>
              <Markdown items={extraction.progress.map((step) => `${stepMark(step.status)} ${step.label}`)} variant="UL" />
            </div>
          )
        }
      </QueryView>
    </StackPage>
  )
}

function progressStatus(extraction: Extraction): 'loading' | 'done' {
  return extraction.status === 'succeeded' || extraction.status === 'applied' ? 'done' : 'loading'
}

function stepMark(status: string): string {
  if (status === 'done') return '✓'
  if (status === 'running') return '…'
  if (status === 'failed') return '✗'
  return '·'
}

const GROUP_ORDER: ChangeGroup[] = ['company', 'product', 'certification', 'contact']
const GROUP_LABEL: Record<ChangeGroup, string> = {
  company: t.extraction.groupCompany,
  product: t.extraction.groupProduct,
  certification: t.extraction.groupCertification,
  contact: t.extraction.groupContact,
}

export function ExtractionReviewPage() {
  const { id = '' } = useParams()
  const query = useQuery({ queryKey: ['extraction', id], queryFn: () => api.extraction(id) })
  return (
    <QueryView query={query}>
      {(extraction) => <ReviewForm extraction={extraction} />}
    </QueryView>
  )
}

export function ReviewForm({ extraction }: { extraction: Extraction }) {
  const navigate = useNavigate()
  const toast = useToast()
  const showError = useErrorToast()
  const queryClient = useQueryClient()
  const [accepted, setAccepted] = useState<Set<string>>(() => new Set(extraction.changes.map((change) => change.id)))
  const [overrides, setOverrides] = useState<Record<string, unknown>>({})
  const [editing, setEditing] = useState<ExtractionChange | null>(null)
  const [draft, setDraft] = useState('')

  const groups = useMemo(
    () =>
      GROUP_ORDER.map((group) => ({ group, items: extraction.changes.filter((change) => change.group === group) })).filter(
        (entry) => entry.items.length > 0,
      ),
    [extraction.changes],
  )

  const apply = useMutation({
    mutationFn: () => api.applyExtraction(extraction.id, { accept: Array.from(accepted), overrides }),
    onSuccess: async (result) => {
      toast.show(t.extraction.merged(result.completeness))
      await queryClient.invalidateQueries({ queryKey: ['profile'] })
      await queryClient.invalidateQueries({ queryKey: ['products'] })
      navigate('/me/profile', { replace: true })
    },
    onError: showError,
  })

  function toggle(id: string) {
    setAccepted((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  if (extraction.status !== 'succeeded' || extraction.changes.length === 0) {
    return (
      <StackPage backTo="/me" title={t.extraction.reviewTitle}>
        <PageCenter>
          <EmptyPage
            buttonLabel={t.extraction.back}
            descText={t.extraction.noChangesDesc}
            illus="noContent"
            onAction={(action) => action === 'press' && navigate('/me', { replace: true })}
          >
            {t.extraction.noChanges}
          </EmptyPage>
        </PageCenter>
      </StackPage>
    )
  }

  const count = accepted.size
  return (
    <StackPage
      backTo="/onboarding"
      footer={
        <Button
          onAction={(action) => action === 'press' && count > 0 && !apply.isPending && apply.mutate()}
          size="L"
          state={count > 0 && !apply.isPending ? 'Default' : 'Disable'}
          type="Primary"
        >
          {t.extraction.merge(count)}
        </Button>
      }
      title={t.extraction.reviewTitle}
    >
      <div className="content-inset">
        <Markdown variant="Body">
          <p>{t.extraction.reviewIntro}</p>
        </Markdown>
      </div>
      {groups.map(({ group, items }) => (
        <section key={group}>
          <ListSectionTitle>{GROUP_LABEL[group]}</ListSectionTitle>
          {items.map((change) => {
            const value = change.id in overrides ? overrides[change.id] : change.value
            const checked = accepted.has(change.id)
            return (
              <div className="review-row" data-change-id={change.id} key={change.id}>
                <span className="review-check">
                  <RadioCheckBox
                    onAction={(action) => action === 'toggle' && toggle(change.id)}
                    size="sm"
                    state={checked ? 'checked' : 'unchecked'}
                    type="circled"
                  />
                </span>
                <SettingsFullWidthItem
                  className="review-item"
                  onAction={(action) => {
                    if (action !== 'open') return
                    setEditing(change)
                    setDraft(editableText(change, value))
                  }}
                  subtitle={describeValue(value)}
                  subtitle2={t.extraction.current(describeValue(change.current) || t.extraction.empty)}
                  trailing={t.extraction.editShort}
                  trailingKind="chevron"
                  type={change.current === null || change.group === 'product' ? '双行列表-常规' : '三行列表-常规'}
                >
                  {change.label}
                </SettingsFullWidthItem>
              </div>
            )
          })}
        </section>
      ))}
      <FormSheet
        onClose={() => setEditing(null)}
        onPrimary={() => {
          if (!editing) return
          setOverrides((prev) => ({ ...prev, [editing.id]: parseEdited(editing, draft) }))
          setAccepted((prev) => new Set(prev).add(editing.id))
          setEditing(null)
        }}
        open={editing !== null}
        primaryLabel={t.common.confirm}
        secondaryLabel={t.common.cancel}
        title={editing ? `${t.extraction.edit}：${editing.label}` : ''}
      >
        <div className="sheet-form">
          <FormDoubleLine maxLength={2000} onChange={setDraft} placeholder={editing?.label ?? ''} value={draft} />
        </div>
      </FormSheet>
    </StackPage>
  )
}
