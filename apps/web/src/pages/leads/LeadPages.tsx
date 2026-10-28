// 商机详情（两栏：左侧内容，右侧操作与跟进）、监控设置。
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ExternalLink, Mail, MessageSquareWarning, Play, Radar } from 'lucide-react'
import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { QueryView } from '@/components/QueryView'
import { useErrorToast } from '@/feedback/useErrorToast'
import { t } from '@/i18n'
import { AppPage } from '@/layout/AppPage'
import { SettingsPage } from '@/layout/SettingsPage'
import { leadsApi, type LeadOut, type WatchOut } from '@/leads/api'
import { LEAD_TYPE_ICON, scoreTone } from '@/leads/LeadCard'
import { joinList, splitList } from '@/lib/validation'
import { FollowUpSection } from '@/outreach/FollowUpSection'
import { useSession } from '@/session/session'
import { Button, Card, CardHeader, ChoiceMenu, ConfirmDialog, Heading, KeyValue, ListGroup, ListRow, NumberList, Progress, Quote, SectionTitle, Select, Switch, Tag, Text, TextArea, useToast } from '@/ui'

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
    <AppPage back="/leads" title={t.leads.detailTitle}>
      <QueryView query={lead}>{(data) => <LeadDetail lead={data} />}</QueryView>
    </AppPage>
  )
}

function LeadDetail({ lead }: { lead: LeadOut }) {
  const toast = useToast()
  const showError = useErrorToast()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
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
  const TypeIcon = LEAD_TYPE_ICON[lead.type]

  return (
    <div className="split lead-detail">
      <div className="stack-lg">
        <Card padding="lg">
          <div className="stack">
            <div className="row">
              <Tag icon={TypeIcon}>{t.leads.types[lead.type]}</Tag>
              <Tag tone={scoreTone(lead.score)}>{t.leads.score(lead.score)}</Tag>
              {lead.deadline ? <Tag tone="warning">{t.leads.deadline(lead.deadline)}</Tag> : null}
              {lead.market ? <Tag>{lead.market}</Tag> : null}
            </div>
            <Heading level={2}>{lead.title}</Heading>
            {lead.reasons.length ? (
              <section className="stack">
                <Heading level={4}>{t.leads.whyTitle}</Heading>
                <NumberList items={lead.reasons} />
              </section>
            ) : null}
            <section className="stack">
              <Heading level={4}>{t.leads.summaryTitle}</Heading>
              <Text className="pre-wrap">{lead.summary_cn}</Text>
            </section>
            {lead.suggested_action ? <Quote tone="accent">{`${t.leads.suggestedTitle}：${lead.suggested_action}`}</Quote> : null}
          </div>
        </Card>

        {lead.buyer ? (
          <ListGroup title={t.leads.buyerTitle}>
            <ListRow subtitle={[lead.buyer.country, lead.buyer.industry, lead.buyer.domain].filter(Boolean).join(' · ') || undefined} title={lead.buyer.name} />
            {contacts?.emails?.map((email) => <ListRow icon={Mail} key={email} title={email} />)}
            {contacts?.phones?.map((phone) => <ListRow key={phone} title={phone} />)}
          </ListGroup>
        ) : null}

        <section>
          <SectionTitle>{t.leads.scoreTitle}</SectionTitle>
          <Card>
            <div className="score-list">
              {lead.score_detail.map((d) => (
                <div className="score-item" key={d.key}>
                  <div className="row-between">
                    <span>{`${d.label}（${Math.round(d.weight * 100)}%）`}</span>
                    <strong>{d.score}</strong>
                  </div>
                  <Progress label={d.label} value={d.score} />
                </div>
              ))}
            </div>
          </Card>
        </section>
      </div>

      <aside className="split__side">
        <Card>
          <CardHeader title={t.leads.actionsTitle} />
          <div className="stack">
            <Button block icon={Mail} onClick={() => navigate(`/leads/${lead.id}/draft`)} size="lg" variant="primary">
              {t.leads.writeEmail}
            </Button>
            {source ? (
              <Button block icon={ExternalLink} onClick={() => setExternal(source)} variant="outline">
                {t.leads.openSource(lead.source_domain)}
              </Button>
            ) : null}
            <Button block icon={MessageSquareWarning} onClick={() => setFeedbackOpen(true)} variant="ghost">
              {t.leads.feedback}
            </Button>
          </div>
        </Card>
        <FollowUpSection leadId={lead.id} />
      </aside>

      <ChoiceMenu
        cancelLabel={t.common.cancel}
        items={t.leads.feedbackItems.map((label) => ({ label }))}
        onCancel={() => setFeedbackOpen(false)}
        onSelect={(index) => {
          setFeedbackOpen(false)
          feedback.mutate(FEEDBACK[index])
        }}
        open={feedbackOpen}
        title={t.leads.feedback}
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
    </div>
  )
}

// ── 监控设置 ───────────────────────────────────────────────────────────

export function WatchSettingsPage() {
  const session = useSession()
  const watches = useQuery({ queryKey: ['watches', session.company?.id], queryFn: leadsApi.watches })
  return (
    <SettingsPage title={t.leads.watchTitle}>
      <QueryView empty={{ title: t.leads.watchEmpty, desc: t.leads.noWatchDesc, icon: Radar }} isEmpty={(items) => items.length === 0} query={watches}>
        {(items) => (
          <div className="stack-lg">
            {items.map((watch) => (
              <WatchEditor key={watch.id} watch={watch} />
            ))}
          </div>
        )}
      </QueryView>
    </SettingsPage>
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
    <Card data-watch-id={watch.id} padding="lg">
      <CardHeader
        actions={<Switch checked={watch.is_active} label={t.leads.watchActive} onChange={(on) => update.mutate({ is_active: on })} showLabel />}
        description={t.leads.watchLastRun(watch.last_run_at?.slice(0, 16).replace('T', ' ') ?? null)}
        icon={Radar}
        title={watch.name}
      />
      <div className="stack">
        {watch.last_run ? <Quote>{t.leads.runStats(watch.last_run.stats)}</Quote> : null}
        <KeyValue
          items={[
            {
              label: t.leads.watchFrequency,
              value: (
                <Select
                  onChange={(frequency) => update.mutate({ frequency })}
                  options={[
                    { value: 'daily', label: t.leads.watchDaily },
                    { value: 'weekly', label: t.leads.watchWeekly },
                  ]}
                  value={watch.frequency === 'weekly' ? 'weekly' : 'daily'}
                />
              ),
            },
          ]}
        />
        <TextArea label={t.leads.watchKeywords} maxLength={1200} onChange={(v) => setDraft((d) => ({ ...d, keywords: v }))} placeholder="ball valve" rows={2} value={draft.keywords} />
        <div className="grid-2">
          <TextArea label={t.leads.watchMarkets} maxLength={1200} onChange={(v) => setDraft((d) => ({ ...d, markets: v }))} placeholder="Germany, Poland" rows={2} value={draft.markets} />
          <TextArea label={t.leads.watchNegative} maxLength={1200} onChange={(v) => setDraft((d) => ({ ...d, negative: v }))} placeholder="used, second-hand" rows={2} value={draft.negative} />
        </div>
        <div className="ui-form-actions">
          <Button disabled={!watch.is_active} icon={Play} loading={run.isPending} onClick={() => run.mutate()} variant="outline">
            {t.leads.watchRunNow}
          </Button>
          <Button
            disabled={!dirty}
            loading={update.isPending}
            onClick={() => update.mutate({ keywords_en: splitList(draft.keywords), markets: splitList(draft.markets), negative_keywords: splitList(draft.negative) })}
            variant="primary"
          >
            {t.common.save}
          </Button>
        </div>
      </div>
    </Card>
  )
}
