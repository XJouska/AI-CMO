// 「官网」Tab：未生成 / 生成中 / 草稿或已发布 三类状态。
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, EmptyPage, ListSectionTitle, Loading, Markdown, NavBar, SettingsFullWidthItem, Tag } from '@yb/generated/components'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '@/api/endpoints'
import { PageCenter } from '@/components/local/StackPage'
import { TabPage } from '@/components/local/TabPage'
import { ConfirmDialog } from '@/feedback/overlays'
import { useToast } from '@/feedback/toast'
import { useErrorToast } from '@/feedback/useErrorToast'
import { t } from '@/i18n'
import { useSession } from '@/session/session'
import { siteApi, type SiteOut } from '@/site/api'
import { isBusy, SECTION_ORDER, sectionSummary } from '@/site/model'

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

export function SitePage() {
  const site = useSite()
  const navigate = useNavigate()
  const nav = (
    <NavBar
      barType="Fixed Color Bg"
      divider={false}
      leftButton={false}
      rightButton={Boolean(site.data?.draft_version_id)}
      rightSlot={
        site.data?.draft_version_id ? (
          <Button onAction={(a) => a === 'press' && navigate('/site/preview')} size="S" type="Text">
            {t.site.preview}
          </Button>
        ) : undefined
      }
      themeBg={false}
    >
      {t.site.title}
    </NavBar>
  )

  return (
    <TabPage nav={nav} surface="secondary">
      {site.isPending ? (
        <PageCenter>
          <Loading>{t.common.loading}</Loading>
        </PageCenter>
      ) : site.isError ? (
        <PageCenter>
          <EmptyPage buttonLabel={t.common.retry} descText={t.common.networkErrorDesc} illus="networkError" onAction={(a) => a === 'press' && void site.refetch()}>
            {t.common.networkErrorTitle}
          </EmptyPage>
        </PageCenter>
      ) : !site.data || (!site.data.draft_version_id && site.data.task.status !== 'running') ? (
        <NoSite failed={site.data?.task.status === 'failed' ? site.data.task.error : ''} />
      ) : !site.data.draft_version_id ? (
        <TaskProgress site={site.data} />
      ) : (
        <SiteDashboard site={site.data} />
      )}
    </TabPage>
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
      <PageCenter>
        <Loading>{t.common.loading}</Loading>
      </PageCenter>
    )
  }
  return (
    <PageCenter>
      <EmptyPage
        buttonLabel={ready ? (failed ? t.site.retry : t.site.generate) : t.site.needProfileAction}
        descText={failed || (ready ? t.site.generateDesc : t.site.needProfile(score))}
        illus={failed ? 'networkError' : 'placeholder'}
        onAction={(action) => {
          if (action !== 'press') return
          if (!ready) navigate('/me/profile')
          else if (!generate.isPending) generate.mutate()
        }}
      >
        {failed ? t.site.taskFailed : t.site.emptyTitle}
      </EmptyPage>
    </PageCenter>
  )
}

function TaskProgress({ site }: { site: SiteOut }) {
  const label = site.task.kind === 'rewrite' ? t.site.rewriting : site.task.kind === 'publish' ? t.site.publishingTask : t.site.generating
  return (
    <div className="content-inset site-progress">
      <Markdown variant="Progress" {...{ status: 'loading' }}>
        {label}
      </Markdown>
      <Markdown items={site.task.progress.map((s) => `${s.status === 'done' ? '✓' : s.status === 'running' ? '…' : s.status === 'failed' ? '✗' : '·'} ${s.label}`)} variant="UL" />
    </div>
  )
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
    <>
      <div className="site-dashboard">
        <section className="site-status">
          <SettingsFullWidthItem
            showDot={site.has_unpublished_changes}
            subtitle={site.url}
            trailing={STATUS_LABEL[site.status]}
            trailingKind="none"
            type="双行列表-常规"
          >
            {t.site.address}
          </SettingsFullWidthItem>
          <SettingsFullWidthItem
            onAction={(a) => a === 'open' && navigate('/site/health')}
            trailing={t.site.health(site.health_score)}
            trailingKind="chevron"
            type="单行列表-常规"
          >
            {t.site.healthTitle}
          </SettingsFullWidthItem>
          {busy ? <TaskProgress site={site} /> : null}
          {site.task.status === 'failed' && site.task.error ? (
            <div className="content-inset">
              <Markdown variant="Body">
                <p>{site.task.error}</p>
              </Markdown>
            </div>
          ) : null}
        </section>

        <ListSectionTitle>{t.site.sectionPages}</ListSectionTitle>
        {draft.data
          ? SECTION_ORDER.map((section) => {
              const flags = draft.data.flags.filter((f) => f.section === section && !f.ack).length
              return (
                <div className="site-section-row" key={section}>
                  <SettingsFullWidthItem
                    onAction={(a) => a === 'open' && navigate(`/site/sections/${section}`)}
                    subtitle={sectionSummary(draft.data.content, section) || ' '}
                    trailing={flags ? t.site.flagged(flags) : ' '}
                    trailingKind="chevron"
                    type="双行列表-常规"
                  >
                    {t.site.sections[section]}
                  </SettingsFullWidthItem>
                  {flags ? (
                    <span className="site-flag-tag">
                      <Tag showIcon={false} type="Badge">
                        {t.site.needsReview}
                      </Tag>
                    </span>
                  ) : null}
                </div>
              )
            })
          : null}

        <ListSectionTitle>{t.site.sectionInquiries}</ListSectionTitle>
        {inquiries.data?.length ? (
          inquiries.data.map((item) => (
            <SettingsFullWidthItem
              key={item.id}
              onAction={(a) => a === 'open' && navigate(`/site/inquiries/${item.id}`)}
              showDot={item.status === 'new'}
              subtitle={item.message}
              trailing={item.created_at.slice(5, 10)}
              trailingKind="chevron"
              type="双行列表-常规"
            >
              {t.site.inquiryFrom(item.company_name || item.name, item.country)}
            </SettingsFullWidthItem>
          ))
        ) : (
          <SettingsFullWidthItem trailing=" " trailingKind="none" type="单行列表-常规">
            {t.site.noInquiries}
          </SettingsFullWidthItem>
        )}
        <SettingsFullWidthItem onAction={(a) => a === 'open' && navigate('/site/inquiries')} trailing={t.site.inquiriesCount(site.inquiry_count, site.new_inquiry_count)} trailingKind="chevron" type="单行列表-常规">
          {t.site.viewAllInquiries}
        </SettingsFullWidthItem>

        <ListSectionTitle>{t.site.sectionSettings}</ListSectionTitle>
        <SettingsFullWidthItem onAction={(a) => a === 'open' && navigate('/site/template')} trailing={t.site.templates[site.template_key]} trailingKind="chevron" type="单行列表-常规">
          {t.site.template}
        </SettingsFullWidthItem>
        <SettingsFullWidthItem onAction={(a) => a === 'open' && navigate('/site/domain')} trailing={site.custom_domain ?? t.me.notSet} trailingKind="chevron" type="单行列表-常规">
          {t.site.domain}
        </SettingsFullWidthItem>
        <SettingsFullWidthItem onAction={(a) => a === 'open' && navigate('/site/sections/seo')} trailing={t.me.manage} trailingKind="chevron" type="单行列表-常规">
          {t.site.seo}
        </SettingsFullWidthItem>
        <SettingsFullWidthItem onAction={(a) => a === 'open' && navigate('/site/versions')} trailing={t.me.manage} trailingKind="chevron" type="单行列表-常规">
          {t.site.versions}
        </SettingsFullWidthItem>
      </div>
      <div className="site-publish-bar">
        <Button onAction={(a) => a === 'press' && canPublish && setConfirming(true)} size="L" state={canPublish && !publish.isPending ? 'Default' : 'Disable'} type="Primary">
          {site.has_unpublished_changes ? t.site.publish : t.site.published}
        </Button>
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
    </>
  )
}

