// 开发信编辑页（两栏）：左侧收件人 / 主题 / 正文；右侧语气、事实校验提示、让 AI 修改、发送方式。
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy, ExternalLink, MailCheck, RefreshCw, Send, Sparkles, Wand2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useErrorToast } from '@/feedback/useErrorToast'
import { t } from '@/i18n'
import { AppPage } from '@/layout/AppPage'
import { outreachApi, type DraftOut, type Tone } from '@/outreach/api'
import { Button, Card, CardHeader, Centered, ConfirmDialog, EmptyState, ErrorState, Quote, Spinner, Tabs, Tag, TextArea, TextField, useToast } from '@/ui'

// 默认语气「专业」放在第一位
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
      <Centered>
        <ErrorState actionLabel={t.common.retry} description={t.common.networkErrorDesc} onRetry={() => void drafts.refetch()} title={t.common.networkErrorTitle} />
      </Centered>
    )
  } else if (drafts.isPending || create.isPending || (empty && !create.isError)) {
    body = (
      <Centered>
        <Spinner label={t.outreach.generating} />
      </Centered>
    )
  } else if (!current) {
    body = (
      <Centered>
        <EmptyState actionLabel={t.outreach.toneGenerate} description={t.outreach.toneEmptyDesc} icon={Sparkles} onAction={regenerate} title={t.outreach.toneEmptyTitle(TONE_LABEL[tone])} />
      </Centered>
    )
  } else {
    body = <DraftEditor draft={current} key={current.id} leadId={id} />
  }

  return (
    <AppPage
      actions={
        <Button disabled={create.isPending} icon={RefreshCw} onClick={regenerate} variant="outline">
          {t.outreach.regenerate}
        </Button>
      }
      back={`/leads/${id}`}
      title={t.outreach.draftTitle}
      toolbar={<Tabs items={TAB_TONES.map((v) => ({ value: v, label: TONE_LABEL[v] }))} label={t.outreach.toneLabel} onChange={setTone} value={tone} />}
    >
      {body}
    </AppPage>
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
    <div className="split draft-editor" data-draft-id={draft.id}>
      <Card padding="lg">
        <div className="stack">
          <div className="row">
            <Tag>{`v${draft.version}`}</Tag>
            <Tag>{t.outreach.words(draft.word_count)}</Tag>
            {sent ? <Tag tone="success">{`${t.outreach.sentStatus} · ${draft.sent_at?.slice(0, 16).replace('T', ' ') ?? ''}`}</Tag> : null}
          </div>
          <TextField disabled={sent} inputMode="email" label={t.outreach.to} maxLength={254} onChange={setTo} placeholder={t.outreach.toPlaceholder} value={to} />
          <TextField disabled={sent} label={t.outreach.subject} maxLength={200} onChange={setSubject} placeholder={t.outreach.subject} value={subject} />
          <TextArea className="draft-body" disabled={sent} label={t.outreach.body} maxLength={6000} onChange={setText} placeholder={t.outreach.body} rows={16} value={text} />
          {dirty && !sent ? (
            <div className="ui-form-actions">
              <Button loading={save.isPending} onClick={() => save.mutate(undefined, { onSuccess: () => toast.show(t.outreach.saved) })} variant="secondary">
                {t.outreach.save}
              </Button>
            </div>
          ) : null}
        </div>
      </Card>

      <aside className="split__side">
        {draft.flags.length ? (
          <Quote tone="warning">{`${t.outreach.flagsTitle}：${draft.flags.map((f) => `${f.text}（${f.reason}）`).join('；')}`}</Quote>
        ) : null}
        {!sent ? (
          <>
            <Card>
              <CardHeader icon={Wand2} title={t.outreach.reviseLabel} />
              <div className="stack">
                <TextField label={t.outreach.reviseLabel} maxLength={300} onChange={setInstruction} onSubmit={() => instruction.trim() && revise.mutate()} placeholder={t.outreach.revisePlaceholder} value={instruction} />
                <Button disabled={!instruction.trim()} loading={revise.isPending} onClick={() => revise.mutate()} variant="secondary">
                  {revise.isPending ? t.outreach.revising : t.outreach.revise}
                </Button>
              </div>
            </Card>
            <Card>
              <CardHeader icon={Send} title={t.outreach.sendWays} />
              <div className="stack">
                {account ? (
                  <Button block icon={Send} loading={send.isPending} onClick={() => (to.trim() ? setConfirming(true) : toast.show(t.outreach.needRecipient))} size="lg" variant="primary">
                    {t.outreach.send}
                  </Button>
                ) : null}
                <Button block icon={Copy} onClick={() => void copy()} size={account ? 'md' : 'lg'} variant={account ? 'outline' : 'primary'}>
                  {t.outreach.copyAll}
                </Button>
                <Button block icon={ExternalLink} onClick={() => (to.trim() ? void openMail() : toast.show(t.outreach.needRecipient))} variant="outline">
                  {t.outreach.openMail}
                </Button>
                <Button block icon={MailCheck} loading={markSent.isPending} onClick={() => markSent.mutate('copy')} variant="ghost">
                  {t.outreach.markSent}
                </Button>
                {!account ? <p className="muted small">{t.outreach.noAccountHint}</p> : null}
              </div>
            </Card>
          </>
        ) : null}
      </aside>

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
