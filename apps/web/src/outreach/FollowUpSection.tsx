// 商机详情中的「跟进」区：阶段 + 推进、下一步（时间提醒）、跟进记录时间线、添加记录。
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, FormDoubleLine, FormSingleLine, ListSectionTitle, SettingsFullWidthItem, Tag } from '@yb/generated/components'
import { useState } from 'react'
import { DateTimeField, toLocalInput } from '@/components/local/DateTimeField'
import { ChoiceSheet, FormSheet } from '@/feedback/overlays'
import { useToast } from '@/feedback/toast'
import { useErrorToast } from '@/feedback/useErrorToast'
import { t } from '@/i18n'
import { CLOSED_STAGES, describeActivity, localInputToIso, outreachApi, shortTime, type FollowUpOut, type Stage } from './api'

const RECORD_KINDS = ['note', 'reply', 'call'] as const

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
    <section className="follow-up" data-stage={pipeline.stage}>
      <ListSectionTitle>{t.outreach.stageTitle}</ListSectionTitle>
      <div className="follow-up-stage content-inset">
        <Tag showIcon={false} type={closed ? 'Default' : 'Badge'}>
          {pipeline.stage_label}
        </Tag>
        <Button onAction={(a) => a === 'press' && !stage.isPending && setStageOpen(true)} size="S" state={stage.isPending ? 'Disable' : 'Default'} type="Secondary">
          {t.outreach.advance}
        </Button>
      </div>
      {!closed ? (
        <SettingsFullWidthItem
          onAction={(a) => {
            if (a !== 'open') return
            setNextText(pipeline.next_action)
            setNextAt(pipeline.next_action_at ? toLocalInput(new Date(pipeline.next_action_at)) : toLocalInput(new Date(Date.now() + 86400_000)))
            setNextOpen(true)
          }}
          subtitle={pipeline.next_action || ' '}
          trailing={nextValue}
          trailingKind="chevron"
          type="双行列表-常规"
        >
          <span data-overdue={pipeline.overdue || undefined}>{t.outreach.nextAction}</span>
        </SettingsFullWidthItem>
      ) : null}

      <ListSectionTitle>{t.outreach.timelineTitle}</ListSectionTitle>
      {data.activities.length ? (
        data.activities.map((a) => {
          const { title, detail } = describeActivity(a, stages, lostReasons)
          return (
            <SettingsFullWidthItem key={a.id} subtitle={detail || shortTime(a.created_at)} trailing={detail ? shortTime(a.created_at) : ' '} trailingKind="none" type="双行列表-常规">
              {title}
            </SettingsFullWidthItem>
          )
        })
      ) : (
        <SettingsFullWidthItem trailing=" " trailingKind="none" type="单行列表-常规">
          {t.outreach.timelineEmpty}
        </SettingsFullWidthItem>
      )}
      <SettingsFullWidthItem onAction={(a) => a === 'open' && setRecordPick(true)} trailing=" " trailingKind="chevron" type="单行列表-常规">
        {t.outreach.addRecord}
      </SettingsFullWidthItem>

      <ChoiceSheet
        cancelLabel={t.common.cancel}
        items={pipeline.allowed_next.map((s) => stages[s])}
        label={t.outreach.advanceTitle}
        onCancel={() => setStageOpen(false)}
        onSelect={(index) => {
          setStageOpen(false)
          const target = pipeline.allowed_next[index]
          if (CLOSED_STAGES.includes(target)) setLostStage(target)
          else stage.mutate({ stage: target })
        }}
        open={stageOpen}
      />
      <ChoiceSheet
        cancelLabel={t.common.cancel}
        description={lostStage ? stages[lostStage] : ''}
        items={lostKeys.map((k) => lostReasons[k])}
        label={t.outreach.lostReasonTitle}
        onCancel={() => setLostStage(null)}
        onSelect={(index) => {
          const target = lostStage!
          setLostStage(null)
          stage.mutate({ stage: target, lost_reason: lostKeys[index] })
        }}
        open={lostStage !== null}
      />
      <ChoiceSheet
        cancelLabel={t.common.cancel}
        items={[...t.outreach.recordKinds]}
        label={t.outreach.addRecord}
        onCancel={() => setRecordPick(false)}
        onSelect={(index) => {
          setRecordPick(false)
          setRecordKind(RECORD_KINDS[index])
        }}
        open={recordPick}
      />
      <FormSheet
        onClose={() => setNextOpen(false)}
        onPrimary={() => !next.isPending && next.mutate()}
        open={nextOpen}
        primaryLabel={t.common.save}
        secondaryLabel={t.common.cancel}
        title={t.outreach.nextActionTitle}
      >
        <div className="sheet-form form-stack">
          <FormSingleLine align="left" label={t.outreach.nextActionLabel} maxLength={200} onChange={setNextText} placeholder={t.outreach.nextActionPlaceholder} value={nextText} />
          <DateTimeField label={t.outreach.nextActionAt} onChange={setNextAt} value={nextAt} />
        </div>
      </FormSheet>
      <FormSheet
        onClose={() => setRecordKind(null)}
        onPrimary={() => recordText.trim() && !record.isPending && record.mutate()}
        open={recordKind !== null}
        primaryLabel={t.common.save}
        secondaryLabel={t.common.cancel}
        title={recordKind ? t.outreach.recordKinds[RECORD_KINDS.indexOf(recordKind)] : ''}
      >
        <div className="sheet-form form-stack">
          <FormDoubleLine label={t.outreach.recordLabel} maxLength={2000} onChange={setRecordText} placeholder={t.outreach.recordPlaceholder} value={recordText} />
        </div>
      </FormSheet>
    </section>
  )
}
