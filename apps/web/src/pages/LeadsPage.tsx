// 商机：指标卡、分类标签、商机卡片网格（分页加载）、筛选、未设置监控 / 等待首批商机 / 网络错误状态。
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Radar, SlidersHorizontal } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useErrorToast } from '@/feedback/useErrorToast'
import { t } from '@/i18n'
import { AppPage } from '@/layout/AppPage'
import { leadsApi, type LeadFilters, type LeadType } from '@/leads/api'
import { LeadCard } from '@/leads/LeadCard'
import { DueList } from '@/outreach/DueList'
import { useSession } from '@/session/session'
import { Button, Centered, EmptyState, ErrorState, FormModal, Spinner, Stat, Tabs, TextField, useToast } from '@/ui'

// 第 2 个分类「跟进」不是商机类型，单独渲染待跟进列表
const DUE_TAB = 1
const TAB_TYPES: (LeadType | undefined)[] = [undefined, undefined, 'tender', 'rfq', 'site_inquiry']

export function useLeadCount() {
  const session = useSession()
  return useQuery({ queryKey: ['leads', session.company?.id, 'count'], queryFn: () => leadsApi.list({}, 0), staleTime: 60_000 })
}

export function LeadsPage() {
  const navigate = useNavigate()
  const session = useSession()
  const [tab, setTab] = useState(0)
  const [filters, setFilters] = useState<LeadFilters>({})
  const [filterOpen, setFilterOpen] = useState(false)
  const [draftMarket, setDraftMarket] = useState('')
  const [draftScore, setDraftScore] = useState('')
  const effective = { ...filters, type: TAB_TYPES[tab] }

  const watches = useQuery({ queryKey: ['watches', session.company?.id], queryFn: leadsApi.watches })
  const leads = useInfiniteQuery({
    queryKey: ['leads', session.company?.id, effective],
    queryFn: ({ pageParam }) => leadsApi.list(effective, pageParam),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((n, p) => n + p.items.length, 0)
      return loaded < last.total ? loaded : undefined
    },
  })

  const first = leads.data?.pages[0]
  const items = leads.data?.pages.flatMap((p) => p.items) ?? []
  const hasActiveWatch = watches.data?.some((w) => w.is_active) ?? false
  const activeFilters = [filters.market, filters.min_score].filter(Boolean).length
  const filtered = Boolean(activeFilters || tab)

  let body
  if (tab === DUE_TAB) {
    body = <DueList />
  } else if (leads.isPending || watches.isPending) {
    body = (
      <Centered>
        <Spinner label={t.common.loading} />
      </Centered>
    )
  } else if (leads.isError || watches.isError) {
    body = (
      <Centered>
        <ErrorState
          actionLabel={t.common.retry}
          description={t.common.networkErrorDesc}
          onRetry={() => {
            void leads.refetch()
            void watches.refetch()
          }}
          title={t.common.networkErrorTitle}
        />
      </Centered>
    )
  } else if (!items.length && !filtered && !hasActiveWatch) {
    body = <NoWatch />
  } else if (!items.length) {
    body = (
      <Centered>
        <EmptyState description={filtered ? t.leads.emptyDesc : t.leads.waitingDesc} icon={Radar} title={filtered ? t.leads.emptyTitle : t.leads.waitingTitle} />
      </Centered>
    )
  } else {
    body = (
      <div className="stack">
        <p className="secondary">{t.leads.overview(first?.today_count ?? 0, first?.total ?? 0)}</p>
        <div className="lead-grid">
          {items.map((lead) => (
            <LeadCard key={lead.id} lead={lead} onOpen={() => navigate(`/leads/${lead.id}`)} />
          ))}
        </div>
        <div className="load-more">
          {leads.hasNextPage ? (
            <Button loading={leads.isFetchingNextPage} onClick={() => void leads.fetchNextPage()} variant="outline">
              {t.leads.loadMore}
            </Button>
          ) : (
            <span className="muted">{t.leads.noMore}</span>
          )}
        </div>
      </div>
    )
  }

  return (
    <AppPage
      actions={
        <>
          <Button className="hide-sm" icon={Radar} onClick={() => navigate('/me/watches')} variant="ghost">
            {t.leads.watchSettings}
          </Button>
          <Button
            icon={SlidersHorizontal}
            onClick={() => {
              setDraftMarket(filters.market ?? '')
              setDraftScore(filters.min_score ? String(filters.min_score) : '')
              setFilterOpen(true)
            }}
            variant="outline"
          >
            {activeFilters ? t.leads.filterActive(activeFilters) : t.leads.filter}
          </Button>
        </>
      }
      title={t.leads.title}
      toolbar={<Tabs items={t.leads.tabs.map((label, index) => ({ value: index, label }))} label={t.leads.tabsLabel} onChange={setTab} value={tab} variant="underline" />}
    >
      {first && tab !== DUE_TAB && items.length ? (
        <div className="grid-3 keep-2 lead-stats">
          <Stat label={t.leads.statToday} tone="accent" value={first.today_count} />
          <Stat label={t.leads.statNew} value={first.new_count} />
          <Stat label={t.leads.statTotal} value={first.total} />
        </div>
      ) : null}
      {body}
      <FormModal
        onClose={() => setFilterOpen(false)}
        onPrimary={() => {
          const score = Number(draftScore)
          setFilters({ market: draftMarket.trim() || undefined, min_score: Number.isFinite(score) && score > 0 ? Math.min(100, score) : undefined })
          setFilterOpen(false)
        }}
        onSecondary={() => {
          setFilters({})
          setFilterOpen(false)
        }}
        open={filterOpen}
        primaryLabel={t.leads.filterApply}
        secondaryLabel={t.leads.filterReset}
        title={t.leads.filterTitle}
      >
        <TextField label={t.leads.filterMarket} maxLength={60} onChange={setDraftMarket} placeholder="Germany" value={draftMarket} />
        <TextField inputMode="numeric" label={t.leads.filterMinScore} maxLength={3} onChange={(v) => setDraftScore(v.replace(/\D/g, ''))} placeholder="60" value={draftScore} />
      </FormModal>
    </AppPage>
  )
}

function NoWatch() {
  const toast = useToast()
  const showError = useErrorToast()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const create = useMutation({
    mutationFn: async () => {
      const draft = await leadsApi.fromProfile()
      const active = await leadsApi.updateWatch(draft.id, { is_active: true })
      await leadsApi.runWatch(active.id).catch(() => null)
      return active
    },
    onSuccess: () => {
      toast.show(t.leads.watchEnabled)
      void queryClient.invalidateQueries({ queryKey: ['watches'] })
      navigate('/me/watches')
    },
    onError: showError,
  })
  return (
    <Centered>
      <EmptyState
        actionLabel={t.leads.noWatchAction}
        actionLoading={create.isPending}
        description={t.leads.noWatchDesc}
        icon={Radar}
        onAction={() => create.mutate()}
        title={t.leads.noWatchTitle}
      />
    </Centered>
  )
}
