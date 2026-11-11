// 海外买家：列表（每个买家一张卡片：哪国、什么公司、要采购什么、为什么适合你、怎么联系）
// 和详情（每种联系方式一份中英文对照话术 + 复制英文 + 一键打开 + 联系进展标记）。
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AtSign, Briefcase, Copy, ExternalLink, Globe2, MessageCircle, Phone, RefreshCw, Search, Sparkles, type LucideIcon } from 'lucide-react'
import { useNavigate, useParams } from 'react-router-dom'
import { useErrorToast } from '@/feedback/useErrorToast'
import { cust } from '@/i18n/customer'
import { AppPage } from '@/layout/AppPage'
import { leadsApi, type LeadOut } from '@/leads/api'
import { useSession } from '@/session/session'
import { serviceApi, type Channel, type ContactState, type KitItem } from '@/service/api'
import { useOverview } from '@/service/components'
import { BuyersTrackCard } from './HomePage'
import { Button, Card, Centered, cx, EmptyState, ErrorState, Spinner, Tag, useToast } from '@/ui'

const CHANNEL_ICON: Record<Channel, LucideIcon> = {
  email: AtSign,
  whatsapp: MessageCircle,
  phone: Phone,
  linkedin: Briefcase,
  form: Globe2,
}

function contactChannels(lead: LeadOut): Channel[] {
  const c = (lead.buyer?.public_contacts ?? {}) as Record<string, unknown>
  const out: Channel[] = []
  if (Array.isArray(c.emails) && c.emails.length) out.push('email')
  if (Array.isArray(c.whatsapp) && c.whatsapp.length) out.push('whatsapp')
  if (Array.isArray(c.phones) && c.phones.length) out.push('phone')
  if (typeof c.linkedin === 'string' && c.linkedin) out.push('linkedin')
  if (typeof c.form_url === 'string' && c.form_url) out.push('form')
  return out
}

function stateOf(status: string): ContactState {
  if (status === 'lost' || status === 'invalid') return 'not_interested'
  if (status === 'new' || status === 'viewed') return 'none'
  if (status === 'contacted') return 'contacted'
  return 'replied'
}

export function BuyersPage() {
  const session = useSession()
  const navigate = useNavigate()
  const overview = useOverview()
  const list = useInfiniteQuery({
    queryKey: ['buyers', session.company?.id],
    queryFn: ({ pageParam }) => leadsApi.list({}, pageParam),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((n, p) => n + p.items.length, 0)
      return loaded < last.total ? loaded : undefined
    },
  })
  const items = list.data?.pages.flatMap((p) => p.items) ?? []
  const state = overview.data?.buyers.state ?? 'none'
  const emptyDesc = { none: cust.buyers.emptyNone, preparing: cust.buyers.emptyPreparing, searching: cust.buyers.emptySearching, found: cust.buyers.emptySearching, failed: cust.buyers.emptyFailed }[state]
  return (
    <AppPage description={items.length ? cust.buyers.intro : undefined} title={cust.buyers.title} width="narrow">
      {list.isPending ? (
        <Centered>
          <Spinner />
        </Centered>
      ) : list.isError ? (
        <ErrorState actionLabel="重新加载" description="请检查网络后重试" onRetry={() => void list.refetch()} title="网络不太顺畅" />
      ) : items.length === 0 ? (
        <div className="stack-lg">
          <EmptyState
            actionLabel={state === 'none' ? cust.buyers.goStart : undefined}
            description={emptyDesc}
            icon={Search}
            onAction={state === 'none' ? () => navigate('/start') : undefined}
            title={cust.buyers.empty}
          />
          {overview.data && state !== 'none' ? <BuyersTrackCard data={overview.data} /> : null}
        </div>
      ) : (
        <div className="buyer-list">
          {items.map((lead) => (
            <BuyerCard key={lead.id} lead={lead} onOpen={() => navigate(`/buyers/${lead.id}`)} />
          ))}
          {list.hasNextPage ? (
            <Button loading={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()} variant="secondary">
              加载更多
            </Button>
          ) : null}
        </div>
      )}
    </AppPage>
  )
}

function BuyerCard({ lead, onOpen }: { lead: LeadOut; onOpen: () => void }) {
  const channels = contactChannels(lead)
  const state = stateOf(lead.status)
  return (
    <article className={cx('buyer-card', lead.is_new && 'is-new')} data-lead-id={lead.id}>
      <header className="buyer-card__head">
        <div>
          <p className="buyer-card__where">
            {[lead.buyer?.country || lead.market, lead.deadline ? cust.buyers.deadline(lead.deadline) : ''].filter(Boolean).join(' · ')}
          </p>
          <h3 className="buyer-card__name">{lead.buyer?.name || lead.title}</h3>
        </div>
        <div className="buyer-card__tags">
          {lead.is_new ? <Tag tone="danger">{cust.buyers.newTag}</Tag> : null}
          {state !== 'none' ? <Tag tone={state === 'replied' ? 'success' : 'neutral'}>{cust.buyers.states[state]}</Tag> : null}
        </div>
      </header>
      <dl className="buyer-card__facts">
        <div>
          <dt>{cust.buyers.wants}</dt>
          <dd>{lead.summary_cn || lead.title}</dd>
        </div>
        {lead.reasons.length ? (
          <div>
            <dt>{cust.buyers.why}</dt>
            <dd>{lead.reasons.slice(0, 2).join('；')}</dd>
          </div>
        ) : null}
        <div>
          <dt>{cust.buyers.how}</dt>
          <dd className="buyer-card__channels">
            {channels.length
              ? channels.map((c) => {
                  const Icon = CHANNEL_ICON[c]
                  return (
                    <span className="channel-chip" key={c}>
                      <Icon aria-hidden size={14} />
                      {cust.buyers.channels[c]}
                    </span>
                  )
                })
              : cust.buyers.noContact}
          </dd>
        </div>
      </dl>
      <Button className="buyer-card__open" onClick={onOpen} variant="primary">
        {cust.buyers.detail}
      </Button>
    </article>
  )
}

export function BuyerDetailPage() {
  const { id = '' } = useParams()
  const session = useSession()
  const queryClient = useQueryClient()
  const showError = useErrorToast()
  const lead = useQuery({ queryKey: ['lead', session.company?.id, id], queryFn: () => leadsApi.get(id) })
  const kit = useQuery({ queryKey: ['kit', id], queryFn: () => serviceApi.kit(id) })
  const create = useMutation({
    mutationFn: () => serviceApi.createKit(id),
    onSuccess: (data) => queryClient.setQueryData(['kit', id], data),
    onError: showError,
  })
  const mark = useMutation({
    mutationFn: (state: Exclude<ContactState, 'none'>) => serviceApi.setContactState(id, state),
    onSuccess: async (data) => {
      queryClient.setQueryData(['kit', id], data)
      await queryClient.invalidateQueries({ queryKey: ['buyers'] })
    },
    onError: showError,
  })
  const data = lead.data
  const state = kit.data?.contact_state ?? 'none'
  return (
    <AppPage back="/buyers" documentTitle={data?.buyer?.name || cust.buyers.title} title={data?.buyer?.name || cust.buyers.title} width="narrow">
      {!data ? (
        lead.isError ? (
          <ErrorState actionLabel="重新加载" onRetry={() => void lead.refetch()} title="没有找到这个买家" />
        ) : (
          <Centered>
            <Spinner />
          </Centered>
        )
      ) : (
        <div className="stack-lg">
          <Card>
            <dl className="buyer-card__facts">
              <div>
                <dt>{cust.buyers.country}</dt>
                <dd>{data.buyer?.country || data.market || '—'}</dd>
              </div>
              <div>
                <dt>{cust.buyers.wants}</dt>
                <dd>{data.summary_cn || data.title}</dd>
              </div>
              {data.reasons.length ? (
                <div>
                  <dt>{cust.buyers.why}</dt>
                  <dd>
                    <ul className="plain-list">
                      {data.reasons.map((r) => (
                        <li key={r}>{r}</li>
                      ))}
                    </ul>
                  </dd>
                </div>
              ) : null}
              {data.deadline ? (
                <div>
                  <dt>截止时间</dt>
                  <dd>{data.deadline}</dd>
                </div>
              ) : null}
            </dl>
          </Card>

          <Card>
            <p className="cust-section-title">{cust.buyers.stateLabel}</p>
            <div aria-label={cust.buyers.stateLabel} className="state-buttons" role="group">
              {(['contacted', 'replied', 'not_interested'] as const).map((s) => (
                <Button
                  aria-pressed={state === s}
                  disabled={mark.isPending}
                  key={s}
                  onClick={() => mark.mutate(s)}
                  variant={state === s ? 'primary' : 'secondary'}
                >
                  {s === 'contacted' ? cust.buyers.markContacted : s === 'replied' ? cust.buyers.markReplied : cust.buyers.markNo}
                </Button>
              ))}
            </div>
          </Card>

          <section className="kit">
            <div className="row-between">
              <div>
                <h2 className="cust-section-title">{cust.buyers.kitTitle}</h2>
                <p className="muted">{cust.buyers.kitDesc}</p>
              </div>
              {kit.data?.items.length ? (
                <Button icon={RefreshCw} loading={create.isPending} onClick={() => create.mutate()} size="sm" variant="ghost">
                  {cust.buyers.kitRedo}
                </Button>
              ) : null}
            </div>
            {kit.isPending ? (
              <Centered>
                <Spinner />
              </Centered>
            ) : kit.data?.items.length ? (
              kit.data.items.map((item) => <KitCard item={item} key={item.id} />)
            ) : (
              <Card className="kit-empty">
                <p>{create.isPending ? cust.buyers.kitCreating : cust.buyers.kitEmpty}</p>
                <Button icon={Sparkles} loading={create.isPending} onClick={() => create.mutate()} size="lg" variant="primary">
                  {cust.buyers.kitCreate}
                </Button>
              </Card>
            )}
          </section>
        </div>
      )}
    </AppPage>
  )
}

function KitCard({ item }: { item: KitItem }) {
  const toast = useToast()
  const Icon = CHANNEL_ICON[item.channel]
  async function copy() {
    const text = item.subject ? `${item.subject}\n\n${item.body}` : item.body
    try {
      await navigator.clipboard.writeText(text)
      toast.show(cust.buyers.copied)
    } catch {
      toast.show('复制失败，请长按文字手动复制')
    }
  }
  return (
    <Card className="kit-card" data-channel={item.channel}>
      <header className="kit-card__head">
        <span aria-hidden className="kit-card__icon">
          <Icon size={18} />
        </span>
        <div>
          <h3>{cust.buyers.channels[item.channel]}</h3>
          {item.target ? <p className="kit-card__target">{item.target}</p> : null}
        </div>
      </header>
      <div className="kit-card__cols">
        <div className="kit-card__col">
          <p className="kit-card__lang">{cust.buyers.english}</p>
          {item.subject ? (
            <p className="kit-card__subject">
              <span>{cust.buyers.subject}：</span>
              {item.subject}
            </p>
          ) : null}
          <p className="kit-card__text" lang="en">
            {item.body}
          </p>
        </div>
        <div className="kit-card__col kit-card__col--zh">
          <p className="kit-card__lang">{cust.buyers.chinese}</p>
          {item.subject_zh ? (
            <p className="kit-card__subject">
              <span>{cust.buyers.subject}：</span>
              {item.subject_zh}
            </p>
          ) : null}
          <p className="kit-card__text">{item.body_zh}</p>
        </div>
      </div>
      {item.flags.length ? (
        <div className="kit-card__flags" role="note">
          <p>{cust.buyers.checkWarn}</p>
          <ul>
            {item.flags.map((f) => (
              <li key={`${f.text}-${f.reason}`}>
                「{f.text}」{f.reason}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="row-wrap">
        <Button icon={Copy} onClick={() => void copy()} variant="primary">
          {cust.buyers.copyEn}
        </Button>
        {item.open_link ? (
          <a className="ui-btn ui-btn--secondary ui-btn--md" href={item.open_link} rel="noopener noreferrer" target={item.open_link.startsWith('http') ? '_blank' : undefined}>
            <ExternalLink aria-hidden size={16} />
            <span>{cust.buyers.openApp[item.channel]}</span>
          </a>
        ) : null}
      </div>
    </Card>
  )
}
