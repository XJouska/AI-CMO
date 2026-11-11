// 客户首页：两条线——「找海外买家」（填完产品就开始）和「英文网站」（AI 生成、你确认），
// 再加一张「下一步」卡片和这周的结果。
import { ArrowRight, Clock3, Globe, Inbox, Loader2, Search, UserCheck } from 'lucide-react'
import { Navigate, useNavigate } from 'react-router-dom'
import { cust } from '@/i18n/customer'
import { AppPage } from '@/layout/AppPage'
import { useSession } from '@/session/session'
import type { Overview } from '@/service/api'
import { StageTrack, useOverview } from '@/service/components'
import { Button, Card, Centered, cx, ErrorState, Spinner, Stat } from '@/ui'

export function CustomerHomePage() {
  const session = useSession()
  const navigate = useNavigate()
  // 产品还在整理时会自动定时刷新（useOverview），整理完立刻显示「正在找买家」
  const overview = useOverview()
  const data = overview.data
  if (overview.isPending) {
    return (
      <AppPage title={cust.home.title} width="narrow">
        <Centered>
          <Spinner />
        </Centered>
      </AppPage>
    )
  }
  if (overview.isError || !data) {
    return (
      <AppPage title={cust.home.title} width="narrow">
        <ErrorState actionLabel="重新加载" description="请检查网络后重试" onRetry={() => void overview.refetch()} title="网络不太顺畅" />
      </AppPage>
    )
  }
  // 还没走完开通第 1 步的老板直接进入向导
  if (!data.submitted && !session.user?.is_staff) return <Navigate replace to="/start" />
  const next = data.next
  const name = session.user?.name || session.company?.name_cn || ''
  return (
    <AppPage title={cust.home.title} width="narrow">
      <div className="cust-home">
        <section className="cust-hello">
          <h2>{cust.home.welcome(name)}</h2>
          <p>{cust.home.intro}</p>
        </section>

        <Card className="cust-next" data-stage={data.stage}>
          <p className="cust-next__label">{cust.home.nextTitle}</p>
          <h2 className="cust-next__title">{next.title}</h2>
          <p className="cust-next__body">{next.body}</p>
          {next.action ? (
            <Button icon={ArrowRight} onClick={() => navigate(next.link)} size="lg" variant="primary">
              {next.action}
            </Button>
          ) : (
            <p className="cust-next__wait">
              <Clock3 aria-hidden size={16} />
              {cust.home.waiting}
            </p>
          )}
        </Card>

        <BuyersTrackCard data={data} onOpen={() => navigate(data.buyers.state === 'none' ? '/start' : '/buyers')} />

        <Card className="cust-progress">
          <h2 className="cust-section-title">
            <Globe aria-hidden size={18} />
            {cust.home.siteTrack}
          </h2>
          <StageTrack stages={data.stages} />
        </Card>

        <section aria-labelledby="week-title" className="cust-week">
          <h2 className="cust-section-title" id="week-title">
            {cust.home.weekTitle}
          </h2>
          <div className="cust-week__grid">
            <button className="cust-stat" onClick={() => navigate('/buyers')} type="button">
              <Stat icon={UserCheck} label={cust.home.buyersWeek} value={data.week.buyers_week} />
            </button>
            <button className="cust-stat" onClick={() => navigate('/buyers')} type="button">
              <Stat icon={UserCheck} label={cust.home.buyersTotal} value={data.week.buyers_total} />
            </button>
            <button className="cust-stat" onClick={() => navigate('/my-site')} type="button">
              <Stat icon={Inbox} label={cust.home.inquiriesWeek} value={data.week.inquiries_week} />
            </button>
          </div>
          {data.site_url ? (
            <a className="cust-site-link" href={data.site_url} rel="noopener noreferrer" target="_blank">
              <Globe aria-hidden size={16} />
              {data.site_url}
            </a>
          ) : null}
        </section>
      </div>
    </AppPage>
  )
}

/** 找买家这条线：现在在干什么、在找什么产品、找哪些市场。 */
export function BuyersTrackCard({ data, onOpen }: { data: Overview; onOpen?: () => void }) {
  const b = data.buyers
  const label = b.state === 'found' ? cust.home.buyersState.found(b.found) : cust.home.buyersState[b.state]
  return (
    <Card className={cx('buyers-track', `is-${b.state}`)} data-buyers-state={b.state}>
      <div className="buyers-track__head">
        <h2 className="cust-section-title">
          <Search aria-hidden size={18} />
          {cust.home.buyersTrack}
        </h2>
        <span className="buyers-track__state">
          {b.state === 'preparing' || b.state === 'searching' ? <Loader2 aria-hidden className="ui-spin" size={14} /> : null}
          {label}
        </span>
      </div>
      <p className="buyers-track__desc">{cust.home.buyersDesc[b.state]}</p>
      {b.products.length ? (
        <ul className="buyers-track__facts">
          <li>{cust.home.searchingFor(b.products.join('、'))}</li>
          <li>{cust.home.searchingIn(b.markets.length ? b.markets.join('、') : cust.home.anyMarket)}</li>
        </ul>
      ) : null}
      {onOpen && (b.state === 'found' || b.state === 'none') ? (
        <Button icon={ArrowRight} onClick={onOpen} variant={b.state === 'found' ? 'primary' : 'secondary'}>
          {b.state === 'found' ? cust.buyers.detail : cust.buyers.goStart}
        </Button>
      ) : null}
    </Card>
  )
}
