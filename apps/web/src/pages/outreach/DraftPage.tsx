// 开发信编辑页：语气 Tab、收件人 / 主题 / 正文、事实校验提示、让 AI 修改、复制 / 用邮箱打开 / 确认发送。
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, EmptyPage, FormDoubleLine, FormSingleLine, ListSectionTitle, Loading, Markdown, SettingsFullWidthItem, Tab, Tag } from '@yb/generated/components'
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { PageCenter, StackPage } from '@/components/local/StackPage'
import { ConfirmDialog } from '@/feedback/overlays'
import { useToast } from '@/feedback/toast'
import { useErrorToast } from '@/feedback/useErrorToast'
import { t } from '@/i18n'
import { outreachApi, type DraftOut, type Tone } from '@/outreach/api'

// Tab 顺序即语气顺序；正式 Tab 默认选中第一项，因此「专业」放在第一位作为默认语气
const TAB_TONES: Tone[] = ['professional', 'concise', 'warm']
const TONE_LABEL: Record<Tone, string> = { concise: t.outreach.tones[0], professional: t.outreach.tones[1], warm: t.outreach.tones[2] }

export function DraftPage() {
  const { id = '' } = useParams()
  const showError = useErrorToast()
  const queryClient = useQueryClient()
  const drafts = useQuery({ queryKey: ['drafts', id], queryFn: () => outreachApi.drafts(id) })
  const [tone, setTone] = useState<Tone>('professional')
  const create = useMutation({
    mutationFn: (value: Tone) => outreachApi.newDraft(id, value),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['drafts', id] }),
    onError: showError,
  })
  // 首次进入且没有草稿：自动生成一封
  const empty = drafts.data !== undefined && drafts.data.length === 0
  useEffect(() => {
    if (empty && !create.isPending && !create.isError) create.mutate('professional')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empty])

  const current = drafts.data?.find((d) => d.tone === tone && d.status !== 'sent') ?? drafts.data?.find((d) => d.tone === tone)
  const regenerate = () => !create.isPending && create.mutate(tone)

  let body
  if (drafts.isError) {
    body = (
      <PageCenter>
        <EmptyPage buttonLabel={t.common.retry} descText={t.common.networkErrorDesc} illus="networkError" onAction={(a) => a === 'press' && void drafts.refetch()}>
          {t.common.networkErrorTitle}
        </EmptyPage>
      </PageCenter>
    )
  } else if (drafts.isPending || create.isPending || (empty && !create.isError)) {
    body = (
      <PageCenter>
        <Loading>{t.outreach.generating}</Loading>
      </PageCenter>
    )
  } else if (!current) {
    body = (
      <PageCenter>
        <EmptyPage buttonLabel={t.outreach.toneGenerate} descText={t.outreach.toneEmptyDesc} illus="noContent" onAction={(a) => a === 'press' && regenerate()}>
          {t.outreach.toneEmptyTitle(TONE_LABEL[tone])}
        </EmptyPage>
      </PageCenter>
    )
  } else {
    body = <DraftEditor draft={current} key={current.id} leadId={id} />
  }

  return (
    <StackPage
      backTo={`/leads/${id}`}
      right={
        <Button onAction={(a) => a === 'press' && regenerate()} size="S" state={create.isPending ? 'Disable' : 'Default'} type="Text">
          {t.outreach.regenerate}
        </Button>
      }
      surface="primary"
      title={t.outreach.draftTitle}
    >
      <div className="leads-tabs" data-surface="primary">
        <Tab items={TAB_TONES.map((v) => TONE_LABEL[v])} onAction={(a) => a.startsWith('tab:') && setTone(TAB_TONES[Number(a.slice(4))])} />
      </div>
      {body}
    </StackPage>
  )
}

function DraftEditor({ draft, leadId }: { draft: DraftOut; leadId: string }) {
  const toast = useToast()
  const showError = useErrorToast()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [to, setTo] = useState(draft.to_email)
  const [subject, setSubject] = useState(draft.subject)
  const [text, setText] = useState(draft.body)
  const [instruction, setInstruction] = useState('')
  const [confirming, setConfirming] = useState(false)
  const accounts = useQuery({ queryKey: ['mail-accounts'], queryFn: outreachApi.mailAccounts })
  const account = accounts.data?.find((a) => a.verified)
  const sent = draft.status === 'sent'
  const dirty = to !== draft.to_email || subject !== draft.subject || text !== draft.body

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['drafts', leadId] })
    void queryClient.invalidateQueries({ queryKey: ['follow-up', leadId] })
  }
  const save = useMutation({
    mutationFn: () => outreachApi.editDraft(draft.id, { to_email: to.trim(), subject: subject.trim(), body: text.trim() }),
    onSuccess: (d) => {
      queryClient.setQueryData<DraftOut[]>(['drafts', leadId], (list) => list?.map((x) => (x.id === d.id ? d : x)))
      return d
    },
    onError: showError,
  })
  const revise = useMutation({
    mutationFn: () => outreachApi.revise(draft.id, instruction.trim()),
    onSuccess: () => {
      setInstruction('')
      refresh()
    },
    onError: showError,
  })
  const markSent = useMutation({
    mutationFn: (method: 'copy' | 'mailto') => outreachApi.markSent(draft.id, method),
    onSuccess: () => {
      refresh()
      toast.show(t.outreach.markedSent)
      navigate(`/leads/${leadId}`)
    },
    onError: showError,
  })
  const send = useMutation({
    mutationFn: async () => {
      const saved = dirty ? await save.mutateAsync() : draft
      return outreachApi.send(draft.id, { mail_account_id: account!.id, confirm_to: saved.to_email, confirm_subject: saved.subject })
    },
    onSuccess: (r) => {
      refresh()
      toast.show(t.outreach.sent(r.remaining_today))
      navigate(`/leads/${leadId}`)
    },
    onError: showError,
  })

  const ensureSaved = async () => (dirty ? save.mutateAsync() : draft)
  const copy = async () => {
    const saved = await ensureSaved()
    await navigator.clipboard?.writeText(`${saved.subject}\n\n${saved.body}`).catch(() => undefined)
    toast.show(t.outreach.copiedHint)
  }
  const openMail = async () => {
    const saved = await ensureSaved()
    window.location.href = saved.mailto
  }

  return (
    <div className="draft-editor" data-draft-id={draft.id}>
      <div className="content-inset lead-card-tags">
        <Tag showIcon={false} type="Default">
          {`v${draft.version}`}
        </Tag>
        <Tag showIcon={false} type="Default">
          {t.outreach.words(draft.word_count)}
        </Tag>
        {sent ? (
          <Tag showIcon={false} type="Badge">
            {t.outreach.sentStatus}
          </Tag>
        ) : null}
      </div>
      {draft.flags.length ? (
        <div className="content-inset">
          <Markdown quoteText={<p>{`${t.outreach.flagsTitle}：${draft.flags.map((f) => `${f.text}（${f.reason}）`).join('；')}`}</p>} variant="Quote" />
        </div>
      ) : null}
      <div className="form-stack">
        <FormSingleLine align="left" label={t.outreach.to} maxLength={254} onChange={setTo} placeholder={t.outreach.toPlaceholder} value={to} />
        <FormSingleLine align="left" label={t.outreach.subject} maxLength={200} onChange={setSubject} placeholder={t.outreach.subject} value={subject} />
        <div className="draft-body">
          <FormDoubleLine label={t.outreach.body} maxLength={6000} onChange={setText} placeholder={t.outreach.body} value={text} />
        </div>
        {dirty && !sent ? (
          <div className="form-actions">
            <Button onAction={(a) => a === 'press' && !save.isPending && save.mutate(undefined, { onSuccess: () => toast.show(t.outreach.saved) })} size="M" state={save.isPending ? 'Disable' : 'Default'} type="Secondary">
              {t.outreach.save}
            </Button>
          </div>
        ) : null}
      </div>

      {!sent ? (
        <>
          <ListSectionTitle>{t.outreach.reviseLabel}</ListSectionTitle>
          <div className="form-stack">
            <FormSingleLine align="left" label={t.outreach.reviseLabel} maxLength={300} onChange={setInstruction} placeholder={t.outreach.revisePlaceholder} value={instruction} />
            <div className="form-actions">
              <Button onAction={(a) => a === 'press' && instruction.trim() && !revise.isPending && revise.mutate()} size="M" state={instruction.trim() && !revise.isPending ? 'Default' : 'Disable'} type="Secondary">
                {revise.isPending ? t.outreach.revising : t.outreach.revise}
              </Button>
            </div>
          </div>

          <div className="form-actions content-inset">
            {account ? (
              <Button onAction={(a) => a === 'press' && (to.trim() ? setConfirming(true) : toast.show(t.outreach.needRecipient))} size="L" state={send.isPending ? 'Disable' : 'Default'} type="Primary">
                {t.outreach.send}
              </Button>
            ) : null}
            <Button onAction={(a) => a === 'press' && void copy()} size="L" type={account ? 'Secondary' : 'Primary'}>
              {t.outreach.copyAll}
            </Button>
            <Button onAction={(a) => a === 'press' && (to.trim() ? void openMail() : toast.show(t.outreach.needRecipient))} size="L" type="Secondary">
              {t.outreach.openMail}
            </Button>
            <Button onAction={(a) => a === 'press' && !markSent.isPending && markSent.mutate('copy')} size="M" type="Text">
              {t.outreach.markSent}
            </Button>
          </div>
        </>
      ) : (
        <SettingsFullWidthItem trailing={draft.sent_at?.slice(0, 16).replace('T', ' ') ?? ' '} trailingKind="none" type="单行列表-常规">
          {t.outreach.sentStatus}
        </SettingsFullWidthItem>
      )}

      <ConfirmDialog
        body={account ? t.outreach.sendBody(account.from_address, to.trim(), subject.trim()) : ''}
        cancelLabel={t.common.cancel}
        confirmLabel={t.outreach.send}
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false)
          send.mutate()
        }}
        open={confirming}
        title={t.outreach.sendTitle}
      />
    </div>
  )
}
