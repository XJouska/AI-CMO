// 客户首页：服务进度条、「下一步你要做的事」卡片、这周的结果。
import { ArrowRight, Clock3, Globe, Inbox, UserCheck } from 'lucide-react'
import { Navigate, useNavigate } from 'react-router-dom'
import { cust } from '@/i18n/customer'
import { AppPage } from '@/layout/AppPage'
import { useSession } from '@/session/session'
import { StageTrack, useOverview } from '@/service/components'
import { Button, Card, Centered, ErrorState, Spinner, Stat } from '@/ui'

export function CustomerHomePage() {
  const session = useSession()
  const navigate = useNavigate()
  const overview = useOverview()
  if (overview.isPending) {
    return (
      <AppPage title={cust.home.title} width="narrow">
        <Centered>
          <Spinner />
        </Centered>
      </AppPage>
    )
  }
  if (overview.isError || !overview.data) {
    return (
      <AppPage title={cust.home.title} width="narrow">
        <ErrorState actionLabel="重新加载" description="请检查网络后重试" onRetry={() => void overview.refetch()} title="网络不太顺畅" />
      </AppPage>
    )
  }
  const data = overview.data
  // 还没走完开通向导的老板直接进入向导
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

        <Card className="cust-progress">
          <h2 className="cust-section-title">{cust.home.progressTitle}</h2>
          <StageTrack stages={data.stages} />
        </Card>

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
