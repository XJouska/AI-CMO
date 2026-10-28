// 公开营销首页：首屏、产品示意、核心能力、使用流程、适用企业、常见问题、行动按钮。已登录用户直接进入助手。
import { ArrowRight, Building2, CalendarClock, Check, ChevronDown, FileText, Globe, Mail, Radar, Sparkles, Target, Users, type LucideIcon } from 'lucide-react'
import { useEffect } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { BRAND } from '@/brand'
import { t } from '@/i18n'
import { useSession } from '@/session/session'
import { Button, Tag } from '@/ui'

const FEATURE_ICONS: LucideIcon[] = [Radar, Globe, Mail, CalendarClock]
const STEP_ICONS: LucideIcon[] = [FileText, Globe, Target]
const AUDIENCE_ICONS: LucideIcon[] = [Building2, Users, Sparkles]

export function HomePage() {
  const session = useSession()
  const navigate = useNavigate()

  useEffect(() => {
    document.title = `${BRAND.name} · ${BRAND.tagline}`
  }, [])

  if (session.token) return <Navigate replace to="/assistant" />

  return (
    <div className="home">
      <section className="home-hero">
        <div className="site-container home-hero__inner">
          <div className="home-hero__copy">
            <span className="home-eyebrow">
              <Sparkles aria-hidden size={14} />
              {t.home.eyebrow}
            </span>
            <h1 className="home-hero__title">{t.home.headline}</h1>
            <p className="home-hero__lead">{t.home.subheadline}</p>
            <div className="home-hero__actions">
              <Button iconRight={ArrowRight} onClick={() => navigate('/register')} size="lg" variant="primary">
                {t.home.start}
              </Button>
              <Button onClick={() => navigate('/login')} size="lg" variant="outline">
                {t.home.login}
              </Button>
            </div>
            <ul className="home-trust">
              {t.home.trust.map((item) => (
                <li key={item}>
                  <Check aria-hidden size={14} />
                  {item}
                </li>
              ))}
            </ul>
          </div>
          <ProductMock />
        </div>
      </section>

      <section className="home-section" id="features">
        <div className="site-container">
          <SectionHead desc={t.home.featuresDesc} title={t.home.featuresTitle} />
          <div className="home-features">
            {t.home.features.map((feature, index) => {
              const Icon = FEATURE_ICONS[index]
              return (
                <article className="home-feature" key={feature.title}>
                  <span aria-hidden className="home-feature__icon">
                    <Icon size={20} />
                  </span>
                  <h3>{feature.title}</h3>
                  <p>{feature.desc}</p>
                </article>
              )
            })}
          </div>
        </div>
      </section>

      <section className="home-section home-section--tint" id="how">
        <div className="site-container">
          <SectionHead desc={t.home.stepsDesc} title={t.home.stepsTitle} />
          <ol className="home-steps">
            {t.home.steps.map((step, index) => {
              const Icon = STEP_ICONS[index]
              return (
                <li className="home-step" key={step}>
                  <div className="home-step__top">
                    <span className="home-step__num">{index + 1}</span>
                    <Icon aria-hidden size={18} />
                  </div>
                  <h3>{t.home.stepTitles[index]}</h3>
                  <p>{step}</p>
                </li>
              )
            })}
          </ol>
        </div>
      </section>

      <section className="home-section">
        <div className="site-container">
          <SectionHead desc={t.home.note} title={t.home.audienceTitle} />
          <div className="home-audience">
            {t.home.audience.map((item, index) => {
              const Icon = AUDIENCE_ICONS[index]
              return (
                <article className="home-audience__item" key={item.title}>
                  <Icon aria-hidden size={20} />
                  <div>
                    <h3>{item.title}</h3>
                    <p>{item.desc}</p>
                  </div>
                </article>
              )
            })}
          </div>
        </div>
      </section>

      <section className="home-section home-section--tint" id="faq">
        <div className="site-container home-faq-wrap">
          <SectionHead title={t.home.faqTitle} />
          <div className="home-faq">
            {t.home.faq.map((item) => (
              <details className="home-faq__item" key={item.q}>
                <summary>
                  <span>{item.q}</span>
                  <ChevronDown aria-hidden size={18} />
                </summary>
                <p>{item.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className="home-section">
        <div className="site-container">
          <div className="home-cta">
            <div>
              <h2>{t.home.ctaTitle}</h2>
              <p>{t.home.ctaDesc}</p>
            </div>
            <Button iconRight={ArrowRight} onClick={() => navigate('/register')} size="lg" variant="primary">
              {t.home.start}
            </Button>
          </div>
        </div>
      </section>
    </div>
  )
}

function SectionHead({ title, desc }: { title: string; desc?: string }) {
  return (
    <div className="home-section__head">
      <h2>{title}</h2>
      {desc ? <p>{desc}</p> : null}
    </div>
  )
}

/** 产品界面示意：用组件拼出的商机列表 + 官网状态卡片。 */
function ProductMock() {
  const mock = t.home.mock
  return (
    <div aria-hidden className="home-mock">
      <div className="home-mock__window">
        <div className="home-mock__bar">
          <span />
          <span />
          <span />
        </div>
        <div className="home-mock__body">
          <div className="home-mock__side">
            <span className="is-active" />
            <span />
            <span />
            <span />
          </div>
          <div className="home-mock__main">
            <div className="home-mock__title">
              <Target size={16} />
              {mock.title}
            </div>
            {mock.items.map((item) => (
              <div className="home-mock__lead" key={item.title}>
                <div className="home-mock__lead-top">
                  <Tag tone="neutral">{item.type}</Tag>
                  <Tag tone="accent">{`${item.score} 分`}</Tag>
                </div>
                <div className="home-mock__lead-title">{item.title}</div>
                <div className="home-mock__lead-meta">{item.meta}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="home-mock__float">
        <span className="home-mock__float-icon">
          <Globe size={18} />
        </span>
        <div>
          <div className="home-mock__float-title">{mock.site}</div>
          <div className="home-mock__float-meta">
            <Tag tone="success">{mock.siteStatus}</Tag>
            <span>{mock.health}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
