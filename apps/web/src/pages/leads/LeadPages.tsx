// 商机详情、监控设置。
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, FormDoubleLine, ListSectionTitle, Markdown, SettingsFullWidthItem, Tag } from '@yb/generated/components'
import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { QueryView } from '@/components/local/QueryView'
import { StackPage } from '@/components/local/StackPage'
import { ChoiceSheet, ConfirmDialog } from '@/feedback/overlays'
import { useToast } from '@/feedback/toast'
import { useErrorToast } from '@/feedback/useErrorToast'
import { t } from '@/i18n'
import { leadsApi, type LeadOut, type WatchOut } from '@/leads/api'
import { joinList, splitList } from '@/lib/validation'
import { useSession } from '@/session/session'

const FEEDBACK: ('useful' | 'irrelevant' | 'duplicate' | 'fake')[] = ['useful', 'irrelevant', 'duplicate', 'fake']

/** 只允许 http / https 外链。 */
export function safeExternal(url: string): string | null {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.toString() : null
  } catch {
    return null
  }
}

export function LeadDetailPage() {
  const { id = '' } = useParams()
  const lead = useQuery({ queryKey: ['lead', id], queryFn: () => leadsApi.get(id) })
  return (
    <StackPage backTo="/leads" surface="primary" title={t.leads.detailTitle}>
      <QueryView query={lead}>{(data) => <LeadDetail lead={data} />}</QueryView>
    </StackPage>
  )
}

function LeadDetail({ lead }: { lead: LeadOut }) {
  const toast = useToast()
  const showError = useErrorToast()
  const queryClient = useQueryClient()
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [external, setExternal] = useState<string | null>(null)
  const feedback = useMutation({
    mutationFn: (verdict: (typeof FEEDBACK)[number]) => leadsApi.feedback(lead.id, verdict),
    onSuccess: () => toast.show(t.leads.feedbackThanks),
    onError: showError,
  })
  // 进入详情即标记已读：刷新列表中的「新」标记
  void queryClient.invalidateQueries({ queryKey: ['leads'], refetchType: 'none' })
  const source = safeExternal(lead.source_url)
  const contacts = lead.buyer?.public_contacts
  return (
    <>
      <div className="content-inset lead-detail">
        <div className="lead-card-tags">
          <Tag showIcon={false} type="Default">
            {t.leads.types[lead.type]}
          </Tag>
          <Tag showIcon={false} type="Badge">
            {t.leads.score(lead.score)}
          </Tag>
          {lead.deadline ? (
            <Tag showIcon={false} type="Default">
              {t.leads.deadline(lead.deadline)}
            </Tag>
          ) : null}
        </div>
        <Markdown variant="Others+H3">{lead.title}</Markdown>
        {lead.reasons.length ? (
          <>
            <Markdown variant="Others+H4">{t.leads.whyTitle}</Markdown>
            <Markdown items={lead.reasons} variant="OL" />
          </>
        ) : null}
        <Markdown variant="Others+H4">{t.leads.summaryTitle}</Markdown>
        <Markdown variant="Body">
          <p className="pre-wrap">{lead.summary_cn}</p>
        </Markdown>
        {lead.suggested_action ? (
          <Markdown variant="Quote" quoteText={<p>{`${t.leads.suggestedTitle}：${lead.suggested_action}`}</p>} />
        ) : null}
      </div>

      {lead.buyer ? (
        <section>
          <ListSectionTitle>{t.leads.buyerTitle}</ListSectionTitle>
          <SettingsFullWidthItem subtitle={[lead.buyer.country, lead.buyer.industry, lead.buyer.domain].filter(Boolean).join(' · ') || ' '} trailing=" " trailingKind="none" type="双行列表-常规">
            {lead.buyer.name}
          </SettingsFullWidthItem>
          {contacts?.emails?.map((email) => (
            <SettingsFullWidthItem key={email} trailing=" " trailingKind="none" type="单行列表-常规">
              {email}
            </SettingsFullWidthItem>
          ))}
          {contacts?.phones?.map((phone) => (
            <SettingsFullWidthItem key={phone} trailing=" " trailingKind="none" type="单行列表-常规">
              {phone}
            </SettingsFullWidthItem>
          ))}
        </section>
      ) : null}

      <ListSectionTitle>{t.leads.scoreTitle}</ListSectionTitle>
      {lead.score_detail.map((d) => (
        <SettingsFullWidthItem key={d.key} trailing={`${d.score}`} trailingKind="none" type="单行列表-常规">
          {`${d.label}（${Math.round(d.weight * 100)}%）`}
        </SettingsFullWidthItem>
      ))}

      {source ? (
        <>
          <ListSectionTitle>{t.leads.sourceTitle}</ListSectionTitle>
          <SettingsFullWidthItem onAction={(a) => a === 'open' && setExternal(source)} trailing=" " trailingKind="chevron" type="单行列表-常规">
            {t.leads.openSource(lead.source_domain)}
          </SettingsFullWidthItem>
        </>
      ) : null}

      <div className="form-actions content-inset">
        <Button onAction={(a) => a === 'press' && toast.show(t.common.comingSoon)} size="L" type="Primary">
          {t.leads.writeEmail}
        </Button>
        <Button onAction={(a) => a === 'press' && setFeedbackOpen(true)} size="M" type="Text">
          {t.leads.feedback}
        </Button>
      </div>

      <ChoiceSheet
        cancelLabel={t.common.cancel}
        description={t.leads.feedback}
        items={[...t.leads.feedbackItems]}
        label={t.leads.feedback}
        onCancel={() => setFeedbackOpen(false)}
        onSelect={(index) => {
          setFeedbackOpen(false)
          feedback.mutate(FEEDBACK[index])
        }}
        open={feedbackOpen}
      />
      <ConfirmDialog
        body={external ? t.leads.openSourceDesc(external) : ''}
        cancelLabel={t.common.cancel}
        confirmLabel={t.leads.open}
        onCancel={() => setExternal(null)}
        onConfirm={() => {
          if (external) window.open(external, '_blank', 'noopener,noreferrer')
          setExternal(null)
        }}
        open={external !== null}
        title={t.leads.openSourceConfirm}
      />
    </>
  )
}

// ── 监控设置 ───────────────────────────────────────────────────────────

export function WatchSettingsPage() {
  const session = useSession()
  const watches = useQuery({ queryKey: ['watches', session.company?.id], queryFn: leadsApi.watches })
  return (
    <StackPage backTo="/me" title={t.leads.watchTitle}>
      <QueryView empty={{ title: t.leads.watchEmpty, desc: t.leads.noWatchDesc }} isEmpty={(items) => items.length === 0} query={watches}>
        {(items) => (
          <>
            {items.map((watch) => (
              <WatchEditor key={watch.id} watch={watch} />
            ))}
          </>
        )}
      </QueryView>
    </StackPage>
  )
}

function WatchEditor({ watch }: { watch: WatchOut }) {
  const toast = useToast()
  const showError = useErrorToast()
  const queryClient = useQueryClient()
  const initial = { keywords: joinList(watch.keywords_en), markets: joinList(watch.markets), negative: joinList(watch.negative_keywords) }
  const [draft, setDraft] = useState(initial)
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial)
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['watches'] })
  const update = useMutation({
    mutationFn: (body: Parameters<typeof leadsApi.updateWatch>[1]) => leadsApi.updateWatch(watch.id, body),
    onSuccess: () => {
      refresh()
      toast.show(t.leads.watchSaved)
    },
    onError: showError,
  })
  const run = useMutation({
    mutationFn: () => leadsApi.runWatch(watch.id),
    onSuccess: () => {
      refresh()
      toast.show(t.leads.watchRunStarted)
    },
    onError: showError,
  })
  return (
    <section className="watch-editor" data-watch-id={watch.id}>
      <ListSectionTitle>{watch.name}</ListSectionTitle>
      <SettingsFullWidthItem
        onAction={(a) => a === 'open' && update.mutate({ is_active: !watch.is_active })}
        subtitle={t.leads.watchLastRun(watch.last_run_at?.slice(0, 16).replace('T', ' ') ?? null)}
        trailing={watch.is_active ? t.site.statusPublished : t.me.notSet}
        trailingKind="chevron"
        type="双行列表-常规"
      >
        {t.leads.watchActive}
      </SettingsFullWidthItem>
      {watch.last_run ? (
        <SettingsFullWidthItem trailing=" " trailingKind="none" type="单行列表-常规">
          {t.leads.runStats(watch.last_run.stats)}
        </SettingsFullWidthItem>
      ) : null}
      <SettingsFullWidthItem
        onAction={(a) => a === 'open' && update.mutate({ frequency: watch.frequency === 'daily' ? 'weekly' : 'daily' })}
        trailing={watch.frequency === 'daily' ? t.leads.watchDaily : t.leads.watchWeekly}
        trailingKind="chevron"
        type="单行列表-常规"
      >
        {t.leads.watchFrequency}
      </SettingsFullWidthItem>
      <div className="form-stack">
        <FormDoubleLine label={t.leads.watchKeywords} maxLength={1200} onChange={(v) => setDraft((d) => ({ ...d, keywords: v }))} placeholder="ball valve" value={draft.keywords} />
        <FormDoubleLine label={t.leads.watchMarkets} maxLength={1200} onChange={(v) => setDraft((d) => ({ ...d, markets: v }))} placeholder="Germany, Poland" value={draft.markets} />
        <FormDoubleLine label={t.leads.watchNegative} maxLength={1200} onChange={(v) => setDraft((d) => ({ ...d, negative: v }))} placeholder="used, second-hand" value={draft.negative} />
        <div className="form-actions">
          <Button
            onAction={(a) =>
              a === 'press' &&
              dirty &&
              update.mutate({ keywords_en: splitList(draft.keywords), markets: splitList(draft.markets), negative_keywords: splitList(draft.negative) })
            }
            size="L"
            state={dirty && !update.isPending ? 'Default' : 'Disable'}
            type="Primary"
          >
            {t.common.save}
          </Button>
          <Button onAction={(a) => a === 'press' && !run.isPending && run.mutate()} size="M" state={watch.is_active && !run.isPending ? 'Default' : 'Disable'} type="Secondary">
            {t.leads.watchRunNow}
          </Button>
        </div>
      </div>
    </section>
  )
}
