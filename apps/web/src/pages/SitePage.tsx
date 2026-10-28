// 官网概览：未生成 / 生成中 / 草稿或已发布。已有官网时显示状态指标、页面内容分区、最近询盘与设置。
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Activity, ExternalLink, Eye, FileClock, Globe, Inbox, LayoutTemplate, Link2, Search, Sparkles, UploadCloud } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '@/api/endpoints'
import { StepProgress } from '@/components/StepProgress'
import { useErrorToast } from '@/feedback/useErrorToast'
import { t } from '@/i18n'
import { AppPage } from '@/layout/AppPage'
import { useSession } from '@/session/session'
import { siteApi, type SiteOut } from '@/site/api'
import { isBusy, SECTION_ORDER, sectionSummary } from '@/site/model'
import { Button, Card, CardHeader, Centered, ConfirmDialog, EmptyState, ErrorState, ListGroup, ListRow, Quote, Spinner, Stat, Tag, useToast } from '@/ui'

export function useSite() {
  const session = useSession()
  return useQuery({
    queryKey: ['site', session.company?.id],
    queryFn: siteApi.site,
    refetchInterval: (q) => (q.state.data && isBusy(q.state.data.task) ? 1500 : false),
  })
}

export function useDraft(site: SiteOut | null | undefined) {
  return useQuery({
    queryKey: ['site-draft', site?.draft_version_id],
    queryFn: siteApi.draft,
    enabled: Boolean(site?.draft_version_id),
  })
}

const STATUS_LABEL = { draft: t.site.statusDraft, published: t.site.statusPublished, suspended: t.site.statusSuspended }
const STATUS_TONE = { draft: 'warning', published: 'success', suspended: 'danger' } as const

export function SitePage() {
  const site = useSite()
  const navigate = useNavigate()
  const hasDraft = Boolean(site.data?.draft_version_id)

  return (
    <AppPage
      actions={
        hasDraft ? (
          <Button icon={Eye} onClick={() => navigate('/site/preview')} variant="outline">
            {t.site.preview}
          </Button>
        ) : null
      }
      title={t.site.title}
    >
      {site.isPending ? (
        <Centered>
          <Spinner label={t.common.loading} />
        </Centered>
      ) : site.isError ? (
        <Centered>
          <ErrorState actionLabel={t.common.retry} description={t.common.networkErrorDesc} onRetry={() => void site.refetch()} title={t.common.networkErrorTitle} />
        </Centered>
      ) : !site.data || (!site.data.draft_version_id && site.data.task.status !== 'running') ? (
        <NoSite failed={site.data?.task.status === 'failed' ? site.data.task.error : ''} />
      ) : !site.data.draft_version_id ? (
        <Centered>
          <Card className="site-progress-card" padding="lg">
            <TaskProgress site={site.data} />
          </Card>
        </Centered>
      ) : (
        <SiteDashboard site={site.data} />
      )}
    </AppPage>
  )
}

function NoSite({ failed }: { failed: string }) {
  const navigate = useNavigate()
  const session = useSession()
  const queryClient = useQueryClient()
  const showError = useErrorToast()
  const profile = useQuery({ queryKey: ['profile', session.company?.id], queryFn: api.profile })
  const score = profile.data?.completeness ?? 0
  const ready = score >= 60
  const generate = useMutation({
    mutationFn: () => siteApi.generate(),
    onSuccess: (site) => queryClient.setQueryData(['site', session.company?.id], site),
    onError: showError,
  })
  if (profile.isPending) {
    return (
      <Centered>
        <Spinner label={t.common.loading} />
      </Centered>
    )
  }
  return (
    <Centered>
      <EmptyState
        actionLabel={ready ? (failed ? t.site.retry : t.site.generate) : t.site.needProfileAction}
        actionLoading={generate.isPending}
        description={failed || (ready ? t.site.generateDesc : t.site.needProfile(score))}
        icon={failed ? Activity : Globe}
        onAction={() => {
          if (!ready) navigate('/me/profile')
          else generate.mutate()
        }}
        title={failed ? t.site.taskFailed : t.site.emptyTitle}
      />
    </Centered>
  )
}

function TaskProgress({ site }: { site: SiteOut }) {
  const label = site.task.kind === 'rewrite' ? t.site.rewriting : site.task.kind === 'publish' ? t.site.publishingTask : t.site.generating
  return <StepProgress running steps={site.task.progress.map((s) => ({ key: s.key, label: s.label, status: s.status }))} title={label} />
}

function SiteDashboard({ site }: { site: SiteOut }) {
  const navigate = useNavigate()
  const toast = useToast()
  const showError = useErrorToast()
  const queryClient = useQueryClient()
  const session = useSession()
  const draft = useDraft(site)
  const inquiries = useQuery({ queryKey: ['site-inquiries', site.id, 3], queryFn: () => siteApi.inquiries(3) })
  const [confirming, setConfirming] = useState(false)
  const busy = isBusy(site.task)
  const canPublish = site.has_unpublished_changes && !busy && (session.company?.role === 'owner' || session.company?.role === 'operator')

  const publish = useMutation({
    mutationFn: siteApi.publish,
    onSuccess: (next) => {
      queryClient.setQueryData(['site', session.company?.id], next)
      const poll = window.setInterval(async () => {
        const latest = await siteApi.site().catch(() => null)
        if (!latest || latest.task.status === 'running') return
        window.clearInterval(poll)
        queryClient.setQueryData(['site', session.company?.id], latest)
        if (latest.task.status === 'idle' && latest.status === 'published') toast.show(t.site.publishDone(latest.url))
        else if (latest.task.error) toast.show(latest.task.error)
      }, 1200)
    },
    onError: showError,
  })

  return (
    <div className="site-dashboard stack-lg">
      <Card className="site-hero" padding="lg">
        <div className="site-hero__main">
          <span aria-hidden className="site-hero__icon">
            <Globe size={22} />
          </span>
          <div className="site-hero__text">
            <div className="row">
              <span className="site-hero__label">{t.site.address}</span>
              <Tag tone={STATUS_TONE[site.status]}>{STATUS_LABEL[site.status]}</Tag>
              {site.has_unpublished_changes ? <Tag tone="accent">{t.site.unpublished}</Tag> : null}
            </div>
            <a className="site-hero__url" href={site.url} rel="noopener noreferrer" target="_blank">
              <span>{site.url}</span>
              <ExternalLink aria-hidden size={14} />
            </a>
          </div>
        </div>
        <Button disabled={!canPublish} icon={UploadCloud} loading={publish.isPending} onClick={() => setConfirming(true)} size="lg" variant="primary">
          {site.has_unpublished_changes ? t.site.publish : t.site.published}
        </Button>
      </Card>

      {busy ? (
        <Card>
          <TaskProgress site={site} />
        </Card>
      ) : null}
      {site.task.status === 'failed' && site.task.error ? <Quote tone="warning">{site.task.error}</Quote> : null}

      <div className="grid-3 keep-2">
        <button className="stat-link" onClick={() => navigate('/site/health')} type="button">
          <Stat icon={Activity} label={t.site.healthTitle} value={t.site.health(site.health_score)} />
        </button>
        <button className="stat-link" onClick={() => navigate('/site/inquiries')} type="button">
          <Stat hint={site.new_inquiry_count ? t.site.newInquiries(site.new_inquiry_count) : undefined} icon={Inbox} label={t.site.sectionInquiries} value={site.inquiry_count} />
        </button>
        <Stat icon={Sparkles} label={t.site.flagsLabel} tone={site.unresolved_flags ? 'warning' : undefined} value={site.unresolved_flags} />
      </div>

      <div className="split">
        <ListGroup title={t.site.sectionPages}>
          {draft.data
            ? SECTION_ORDER.map((section) => {
                const flags = draft.data.flags.filter((f) => f.section === section && !f.ack).length
                return (
                  <ListRow
                    className="site-section-row"
                    key={section}
                    onClick={() => navigate(`/site/sections/${section}`)}
                    subtitle={sectionSummary(draft.data.content, section) || undefined}
                    title={t.site.sections[section]}
                    trailing={flags ? <Tag tone="warning">{t.site.flagged(flags)}</Tag> : undefined}
                  />
                )
              })
            : <ListRow title={t.common.loading} />}
        </ListGroup>

        <div className="split__side">
          <Card padding="none">
            <div className="card-pad">
              <CardHeader
                actions={
                  <Button onClick={() => navigate('/site/inquiries')} size="sm" variant="ghost">
                    {t.site.viewAll}
                  </Button>
                }
                description={t.site.inquiriesCount(site.inquiry_count, site.new_inquiry_count)}
                icon={Inbox}
                title={t.site.sectionInquiries}
              />
            </div>
            <div className="card-list">
              {inquiries.data?.length ? (
                inquiries.data.map((item) => (
                  <ListRow
                    dot={item.status === 'new'}
                    key={item.id}
                    onClick={() => navigate(`/site/inquiries/${item.id}`)}
                    subtitle={item.message}
                    title={t.site.inquiryFrom(item.company_name || item.name, item.country)}
                    value={item.created_at.slice(5, 10)}
                  />
                ))
              ) : (
                <ListRow title={t.site.noInquiries} />
              )}
            </div>
          </Card>

          <ListGroup title={t.site.sectionSettings}>
            <ListRow icon={LayoutTemplate} onClick={() => navigate('/site/template')} title={t.site.template} value={t.site.templates[site.template_key]} />
            <ListRow icon={Link2} onClick={() => navigate('/site/domain')} title={t.site.domain} value={site.custom_domain ?? t.me.notSet} />
            <ListRow icon={Search} onClick={() => navigate('/site/sections/seo')} title={t.site.seo} />
            <ListRow icon={FileClock} onClick={() => navigate('/site/versions')} title={t.site.versions} />
          </ListGroup>
        </div>
      </div>

      <ConfirmDialog
        body={[t.site.publishDesc(site.url), site.unresolved_flags ? t.site.publishFlags(site.unresolved_flags) : ''].filter(Boolean).join('\n')}
        cancelLabel={t.common.cancel}
        confirmLabel={t.site.publish}
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false)
          publish.mutate()
        }}
        open={confirming}
        title={t.site.publishConfirm}
      />
    </div>
  )
}
