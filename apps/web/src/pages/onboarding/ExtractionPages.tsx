// AI 抽取进度页与确认变更页。
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Pencil } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { api, type ChangeGroup, type Extraction, type ExtractionChange } from '@/api/endpoints'
import { QueryView } from '@/components/QueryView'
import { StepProgress } from '@/components/StepProgress'
import { useErrorToast } from '@/feedback/useErrorToast'
import { t } from '@/i18n'
import { AuthCard } from '@/layout/AuthLayout'
import { Button, Checkbox, EmptyState, ErrorState, FormModal, SectionTitle, TextArea, useToast } from '@/ui'
import { describeValue, editableText, parseEdited } from './changes'

const POLL_MS = 1500
const STEPS = t.onboarding.steps

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
    <AuthCard steps={{ labels: STEPS, current: 1 }} title={t.extraction.title} wide>
      <QueryView query={query}>
        {(extraction) =>
          extraction.status === 'failed' ? (
            <ErrorState actionLabel={t.extraction.retry} description={extraction.error} onRetry={() => navigate('/onboarding', { replace: true })} title={t.extraction.failed} />
          ) : (
            <StepProgress
              running={!isFinished(extraction)}
              steps={extraction.progress.map((step, index) => ({ key: `${index}`, label: step.label, status: step.status }))}
              title={extraction.status === 'succeeded' ? t.extraction.done : t.extraction.running}
            />
          )
        }
      </QueryView>
    </AuthCard>
  )
}

function isFinished(extraction: Extraction): boolean {
  return extraction.status === 'succeeded' || extraction.status === 'applied'
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
    <AuthCard steps={{ labels: STEPS, current: 2 }} title={t.extraction.reviewTitle} wide>
      <QueryView query={query}>{(extraction) => <ReviewForm extraction={extraction} />}</QueryView>
    </AuthCard>
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
    () => GROUP_ORDER.map((group) => ({ group, items: extraction.changes.filter((change) => change.group === group) })).filter((entry) => entry.items.length > 0),
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
    return <EmptyState actionLabel={t.extraction.back} description={t.extraction.noChangesDesc} onAction={() => navigate('/me', { replace: true })} title={t.extraction.noChanges} />
  }

  const count = accepted.size
  return (
    <>
      <p className="secondary">{t.extraction.reviewIntro}</p>
      {groups.map(({ group, items }) => (
        <section className="review-group" key={group}>
          <SectionTitle>{GROUP_LABEL[group]}</SectionTitle>
          <div className="ui-list">
            {items.map((change) => {
              const value = change.id in overrides ? overrides[change.id] : change.value
              const checked = accepted.has(change.id)
              const showCurrent = !(change.current === null || change.group === 'product')
              return (
                <div className={checked ? 'review-row is-checked' : 'review-row'} data-change-id={change.id} key={change.id}>
                  <Checkbox ariaLabel={change.label} checked={checked} onChange={() => toggle(change.id)} />
                  <div className="review-row__main">
                    <div className="review-row__label">{change.label}</div>
                    <div className="review-row__value">{describeValue(value)}</div>
                    {showCurrent ? <div className="review-row__current">{t.extraction.current(describeValue(change.current) || t.extraction.empty)}</div> : null}
                  </div>
                  <Button
                    icon={Pencil}
                    onClick={() => {
                      setEditing(change)
                      setDraft(editableText(change, value))
                    }}
                    size="sm"
                    variant="ghost"
                  >
                    {t.extraction.editShort}
                  </Button>
                </div>
              )
            })}
          </div>
        </section>
      ))}
      <Button block disabled={count === 0} loading={apply.isPending} onClick={() => apply.mutate()} size="lg" variant="primary">
        {t.extraction.merge(count)}
      </Button>
      <FormModal
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
        <TextArea maxLength={2000} onChange={setDraft} placeholder={editing?.label ?? ''} rows={5} value={draft} />
      </FormModal>
    </>
  )
}
