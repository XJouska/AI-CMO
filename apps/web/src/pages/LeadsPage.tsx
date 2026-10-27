// 「商机」Tab：分类 Tab、今日概览、商机列表（分页加载）、筛选、未设置监控 / 等待首批商机 / 网络错误状态。
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, EmptyPage, FormSingleLine, ListSectionTitle, Loading, NavBar, Tab } from '@yb/generated/components'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PageCenter } from '@/components/local/StackPage'
import { TabPage } from '@/components/local/TabPage'
import { FormSheet } from '@/feedback/overlays'
import { useToast } from '@/feedback/toast'
import { useErrorToast } from '@/feedback/useErrorToast'
import { t } from '@/i18n'
import { leadsApi, type LeadFilters, type LeadType } from '@/leads/api'
import { LeadCard } from '@/leads/LeadCard'
import { DueList } from '@/outreach/DueList'
import { useSession } from '@/session/session'

// 第 2 个 Tab「待跟进」不是商机类型，单独渲染待跟进列表
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

  const nav = (
    <NavBar
      barType="Fixed Color Bg"
      divider={false}
      leftButton={false}
      rightButton
      rightSlot={
        <Button
          onAction={(a) => {
            if (a !== 'press') return
            setDraftMarket(filters.market ?? '')
            setDraftScore(filters.min_score ? String(filters.min_score) : '')
            setFilterOpen(true)
          }}
          size="S"
          type="Text"
        >
          {t.leads.filter}
        </Button>
      }
      themeBg={false}
    >
      {t.leads.title}
    </NavBar>
  )

  const first = leads.data?.pages[0]
  const items = leads.data?.pages.flatMap((p) => p.items) ?? []
  const hasActiveWatch = watches.data?.some((w) => w.is_active) ?? false
  const filtered = Boolean(filters.market || filters.min_score || tab)

  let body
  if (tab === DUE_TAB) {
    body = <DueList />
  } else if (leads.isPending || watches.isPending) {
    body = (
      <PageCenter>
        <Loading>{t.common.loading}</Loading>
      </PageCenter>
    )
  } else if (leads.isError || watches.isError) {
    body = (
      <PageCenter>
        <EmptyPage
          buttonLabel={t.common.retry}
          descText={t.common.networkErrorDesc}
          illus="networkError"
          onAction={(a) => {
            if (a !== 'press') return
            void leads.refetch()
            void watches.refetch()
          }}
        >
          {t.common.networkErrorTitle}
        </EmptyPage>
      </PageCenter>
    )
  } else if (!items.length && !filtered && !hasActiveWatch) {
    body = <NoWatch />
  } else if (!items.length) {
    body = (
      <PageCenter>
        <EmptyPage button={false} descText={filtered ? t.leads.emptyDesc : t.leads.waitingDesc} illus="noContent">
          {filtered ? t.leads.emptyTitle : t.leads.waitingTitle}
        </EmptyPage>
      </PageCenter>
    )
  } else {
    body = (
      <div className="leads-list">
        <ListSectionTitle>{t.leads.overview(first?.today_count ?? 0, first?.total ?? 0)}</ListSectionTitle>
        {items.map((lead) => (
          <LeadCard key={lead.id} lead={lead} onOpen={() => navigate(`/leads/${lead.id}`)} />
        ))}
        <div className="leads-more">
          {leads.hasNextPage ? (
            <Button onAction={(a) => a === 'press' && !leads.isFetchingNextPage && void leads.fetchNextPage()} size="M" state={leads.isFetchingNextPage ? 'Disable' : 'Default'} type="Secondary">
              {t.leads.loadMore}
            </Button>
          ) : (
            <ListSectionTitle>{t.leads.noMore}</ListSectionTitle>
          )}
        </div>
      </div>
    )
  }

  return (
    <TabPage nav={nav} surface="secondary">
      <div className="leads-tabs">
        <Tab items={[...t.leads.tabs]} onAction={(a) => a.startsWith('tab:') && setTab(Number(a.slice(4)))} />
      </div>
      {body}
      <FormSheet
        onClose={() => {
          setFilters({})
          setFilterOpen(false)
        }}
        onPrimary={() => {
          const score = Number(draftScore)
          setFilters({ market: draftMarket.trim() || undefined, min_score: Number.isFinite(score) && score > 0 ? Math.min(100, score) : undefined })
          setFilterOpen(false)
        }}
        open={filterOpen}
        primaryLabel={t.leads.filterApply}
        secondaryLabel={t.leads.filterReset}
        title={t.leads.filterTitle}
      >
        <div className="sheet-form form-stack">
          <FormSingleLine align="left" label={t.leads.filterMarket} maxLength={60} onChange={setDraftMarket} placeholder="Germany" value={draftMarket} />
          <FormSingleLine align="left" label={t.leads.filterMinScore} maxLength={3} onChange={(v) => setDraftScore(v.replace(/\D/g, ''))} placeholder="60" value={draftScore} />
        </div>
      </FormSheet>
    </TabPage>
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
    <PageCenter>
      <EmptyPage
        buttonLabel={t.leads.noWatchAction}
        descText={t.leads.noWatchDesc}
        illus="noContent"
        onAction={(a) => a === 'press' && !create.isPending && create.mutate()}
      >
        {t.leads.noWatchTitle}
      </EmptyPage>
    </PageCenter>
  )
}
