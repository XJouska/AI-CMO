// 商机详情中的「跟进」卡片：阶段 + 推进、下一步（时间提醒）、跟进记录时间线、添加记录。
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarClock, ChevronsRight, Plus } from 'lucide-react'
import { useId, useState } from 'react'
import { useErrorToast } from '@/feedback/useErrorToast'
import { t } from '@/i18n'
import { Button, Card, CardHeader, ChoiceMenu, FieldShell, FormModal, Tag, TextArea, TextField, useToast } from '@/ui'
import { CLOSED_STAGES, describeActivity, localInputToIso, outreachApi, shortTime, type FollowUpOut, type Stage } from './api'

const RECORD_KINDS = ['note', 'reply', 'call'] as const

/** Date → datetime-local 输入值（本地时间）。 */
export function toLocalInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function DateTimeField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const id = useId()
  return (
    <FieldShell id={id} label={label}>
      <div className="ui-input">
        <input id={id} onChange={(event) => onChange(event.target.value)} type="datetime-local" value={value} />
      </div>
    </FieldShell>
  )
}

export function FollowUpSection({ leadId }: { leadId: string }) {
  const followUp = useQuery({ queryKey: ['follow-up', leadId], queryFn: () => outreachApi.followUp(leadId) })
  if (!followUp.data) return null
  return <FollowUp data={followUp.data} leadId={leadId} />
}

function FollowUp({ leadId, data }: { leadId: string; data: FollowUpOut }) {
  const toast = useToast()
  const showError = useErrorToast()
  const queryClient = useQueryClient()
  const [stageOpen, setStageOpen] = useState(false)
  const [lostStage, setLostStage] = useState<Stage | null>(null)
  const [nextOpen, setNextOpen] = useState(false)
  const [nextText, setNextText] = useState('')
  const [nextAt, setNextAt] = useState('')
  const [recordKind, setRecordKind] = useState<(typeof RECORD_KINDS)[number] | null>(null)
  const [recordPick, setRecordPick] = useState(false)
  const [recordText, setRecordText] = useState('')
  const { pipeline, stages, lost_reasons: lostReasons } = data
  const lostKeys = Object.keys(lostReasons)

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['follow-up', leadId] })
    void queryClient.invalidateQueries({ queryKey: ['follow-ups-due'] })
  }
  const stage = useMutation({
    mutationFn: (body: { stage: Stage; lost_reason?: string }) => outreachApi.setStage(leadId, body),
    onSuccess: (p) => {
      refresh()
      toast.show(t.outreach.stageChanged(p.stage_label))
    },
    onError: showError,
  })
  const next = useMutation({
    mutationFn: () => outreachApi.setNextAction(leadId, { next_action: nextText.trim(), next_action_at: localInputToIso(nextAt) }),
    onSuccess: () => {
      refresh()
      setNextOpen(false)
      toast.show(t.outreach.nextActionSaved)
    },
    onError: showError,
  })
  const record = useMutation({
    mutationFn: () => outreachApi.addActivity(leadId, { kind: recordKind!, text: recordText.trim() }),
    onSuccess: () => {
      refresh()
      setRecordKind(null)
      setRecordText('')
      toast.show(t.outreach.recordSaved)
    },
    onError: showError,
  })

  const closed = CLOSED_STAGES.includes(pipeline.stage) || pipeline.stage === 'won'
  const nextValue = pipeline.next_action_at ? t.outreach.dueAt(shortTime(pipeline.next_action_at), pipeline.overdue) : t.outreach.nextActionNone

  return (
    <Card className="follow-up" data-stage={pipeline.stage}>
      <CardHeader
        actions={
          pipeline.allowed_next.length ? (
            <Button icon={ChevronsRight} loading={stage.isPending} onClick={() => setStageOpen(true)} size="sm" variant="outline">
              {t.outreach.advance}
            </Button>
          ) : null
        }
        title={t.outreach.stageTitle}
      />
      <div className="stack">
        <div className="row">
          <Tag tone={closed ? 'neutral' : 'accent'}>{pipeline.stage_label}</Tag>
        </div>

        {!closed ? (
          <button
            className="follow-up__next"
            onClick={() => {
              setNextText(pipeline.next_action)
              setNextAt(pipeline.next_action_at ? toLocalInput(new Date(pipeline.next_action_at)) : toLocalInput(new Date(Date.now() + 86400_000)))
              setNextOpen(true)
            }}
            type="button"
          >
            <CalendarClock aria-hidden size={16} />
            <span className="follow-up__next-main">
              <span data-overdue={pipeline.overdue || undefined}>{t.outreach.nextAction}</span>
              {pipeline.next_action ? <small>{pipeline.next_action}</small> : null}
            </span>
            <Tag tone={pipeline.overdue ? 'danger' : 'neutral'}>{nextValue}</Tag>
          </button>
        ) : null}

        <div className="timeline">
          <div className="row-between">
            <span className="timeline__title">{t.outreach.timelineTitle}</span>
            <Button icon={Plus} onClick={() => setRecordPick(true)} size="sm" variant="ghost">
              {t.outreach.addRecord}
            </Button>
          </div>
          {data.activities.length ? (
            <ol className="timeline__list">
              {data.activities.map((a) => {
                const { title, detail } = describeActivity(a, stages, lostReasons)
                return (
                  <li className="timeline__item" key={a.id}>
                    <span className="timeline__dot" />
                    <div>
                      <div className="timeline__item-title">{title}</div>
                      {detail ? <div className="timeline__detail">{detail}</div> : null}
                      <div className="timeline__time">{shortTime(a.created_at)}</div>
                    </div>
                  </li>
                )
              })}
            </ol>
          ) : (
            <p className="muted">{t.outreach.timelineEmpty}</p>
          )}
        </div>
      </div>

      <ChoiceMenu
        cancelLabel={t.common.cancel}
        items={pipeline.allowed_next.map((s) => ({ label: stages[s], danger: CLOSED_STAGES.includes(s) }))}
        onCancel={() => setStageOpen(false)}
        onSelect={(index) => {
          setStageOpen(false)
          const target = pipeline.allowed_next[index]
          if (CLOSED_STAGES.includes(target)) setLostStage(target)
          else stage.mutate({ stage: target })
        }}
        open={stageOpen}
        title={t.outreach.advanceTitle}
      />
      <ChoiceMenu
        cancelLabel={t.common.cancel}
        description={lostStage ? stages[lostStage] : ''}
        items={lostKeys.map((k) => ({ label: lostReasons[k] }))}
        onCancel={() => setLostStage(null)}
        onSelect={(index) => {
          const target = lostStage!
          setLostStage(null)
          stage.mutate({ stage: target, lost_reason: lostKeys[index] })
        }}
        open={lostStage !== null}
        title={t.outreach.lostReasonTitle}
      />
      <ChoiceMenu
        cancelLabel={t.common.cancel}
        items={t.outreach.recordKinds.map((label) => ({ label }))}
        onCancel={() => setRecordPick(false)}
        onSelect={(index) => {
          setRecordPick(false)
          setRecordKind(RECORD_KINDS[index])
        }}
        open={recordPick}
        title={t.outreach.addRecord}
      />
      <FormModal
        loading={next.isPending}
        onClose={() => setNextOpen(false)}
        onPrimary={() => next.mutate()}
        open={nextOpen}
        primaryLabel={t.common.save}
        secondaryLabel={t.common.cancel}
        title={t.outreach.nextActionTitle}
      >
        <TextField label={t.outreach.nextActionLabel} maxLength={200} onChange={setNextText} placeholder={t.outreach.nextActionPlaceholder} value={nextText} />
        <DateTimeField label={t.outreach.nextActionAt} onChange={setNextAt} value={nextAt} />
      </FormModal>
      <FormModal
        loading={record.isPending}
        onClose={() => setRecordKind(null)}
        onPrimary={() => recordText.trim() && record.mutate()}
        open={recordKind !== null}
        primaryDisabled={!recordText.trim()}
        primaryLabel={t.common.save}
        secondaryLabel={t.common.cancel}
        title={recordKind ? t.outreach.recordKinds[RECORD_KINDS.indexOf(recordKind)] : ''}
      >
        <TextArea label={t.outreach.recordLabel} maxLength={2000} onChange={setRecordText} placeholder={t.outreach.recordPlaceholder} value={recordText} />
      </FormModal>
    </Card>
  )
}
