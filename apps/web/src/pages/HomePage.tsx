// 公开营销首页：用一句大白话说清楚做什么，再用一个具体例子说明「你交什么、得到什么」。已登录用户直接进入工作台。
import { ArrowRight, Building2, Check, ChevronDown, Globe, Inbox, Mail, Sparkles, Target, UserRound, Users, Bot, type LucideIcon } from 'lucide-react'
import { useEffect } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { BRAND } from '@/brand'
import { t } from '@/i18n'
import { useSession } from '@/session/session'
import { Button, Tag } from '@/ui'

const OUTCOME_ICONS: LucideIcon[] = [Globe, Target]
const AUDIENCE_ICONS: LucideIcon[] = [Building2, Users, Sparkles]

export function HomePage() {
  const session = useSession()
  const navigate = useNavigate()
  const h = t.home

  useEffect(() => {
    document.title = `${BRAND.name} · ${BRAND.tagline}`
  }, [])

  if (session.token) return <Navigate replace to="/home" />

  return (
    <div className="home">
      <section className="home-hero">
        <div className="site-container home-hero__inner">
          <div className="home-hero__copy">
            <span className="home-eyebrow">
              <Sparkles aria-hidden size={14} />
              {h.eyebrow}
            </span>
            <h1 className="home-hero__title">{h.headline}</h1>
            <p className="home-hero__lead">{h.subheadline}</p>
            <ul className="home-outcomes">
              {h.outcomes.map((item, index) => {
                const Icon = OUTCOME_ICONS[index]
                return (
                  <li key={item.title}>
                    <span aria-hidden className="home-outcomes__icon">
                      <Icon size={18} />
                    </span>
                    <div>
                      <strong>{item.title}</strong>
                      <p>{item.desc}</p>
                    </div>
                  </li>
                )
              })}
            </ul>
            <div className="home-hero__actions">
              <Button iconRight={ArrowRight} onClick={() => navigate('/register')} size="lg" variant="primary">
                {h.start}
              </Button>
              <Button onClick={() => document.getElementById('example')?.scrollIntoView({ behavior: 'smooth' })} size="lg" variant="outline">
                {h.seeExample}
              </Button>
            </div>
            <p className="home-hero__login">
              {h.hasAccount}{' '}
              <button className="home-link" onClick={() => navigate('/login')} type="button">
                {h.login}
              </button>
            </p>
          </div>
          <ProductMock />
        </div>
      </section>

      <section className="home-section" id="example">
        <div className="site-container">
          <SectionHead desc={h.exampleDesc} title={h.exampleTitle} />
          <ol className="home-timeline">
            {h.example.map((step, index) => (
              <li className="home-timeline__item" key={step.when}>
                <div className="home-timeline__marker">
                  <span>{index + 1}</span>
                </div>
                <div className="home-timeline__body">
                  <div className="home-timeline__when">{step.when}</div>
                  <h3>{step.title}</h3>
                  {step.quote ? <blockquote className="home-timeline__quote">{step.quote}</blockquote> : null}
                  <p>{step.desc}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="home-section home-section--tint" id="how">
        <div className="site-container">
          <SectionHead desc={h.splitDesc} title={h.splitTitle} />
          <div className="home-split">
            <SplitCard icon={UserRound} items={h.youDo} title={h.youDoTitle} />
            <SplitCard accent icon={Bot} items={h.weDo} title={h.weDoTitle} />
          </div>
        </div>
      </section>

      <section className="home-section">
        <div className="site-container">
          <SectionHead desc={h.note} title={h.audienceTitle} />
          <div className="home-audience">
            {h.audience.map((item, index) => {
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
          <SectionHead title={h.faqTitle} />
          <div className="home-faq">
            {h.faq.map((item) => (
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
              <h2>{h.ctaTitle}</h2>
              <p>{h.ctaDesc}</p>
            </div>
            <Button iconRight={ArrowRight} onClick={() => navigate('/register')} size="lg" variant="primary">
              {h.start}
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

function SplitCard({ title, items, icon: Icon, accent }: { title: string; items: readonly string[]; icon: LucideIcon; accent?: boolean }) {
  return (
    <article className={accent ? 'home-split__card is-accent' : 'home-split__card'}>
      <div className="home-split__head">
        <span aria-hidden className="home-split__icon">
          <Icon size={18} />
        </span>
        <h3>{title}</h3>
      </div>
      <ul>
        {items.map((item) => (
          <li key={item}>
            <Check aria-hidden size={16} />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </article>
  )
}

/** 产品示意：用中文展示「每天收到的采购机会」和「已上线的英文官网」，第一次来的人一眼看懂得到什么。 */
function ProductMock() {
  const mock = t.home.mock
  return (
    <div aria-label={mock.label} className="home-mock" role="img">
      <div className="home-mock__window">
        <div className="home-mock__bar">
          <span />
          <span />
          <span />
        </div>
        <div className="home-mock__main">
          <div className="home-mock__title">
            <Target aria-hidden size={16} />
            {mock.title}
          </div>
          {mock.items.map((item) => (
            <div className="home-mock__lead" key={item.title}>
              <div className="home-mock__lead-top">
                <Tag tone="neutral">{item.type}</Tag>
                <span className="home-mock__lead-where">{item.where}</span>
                <Tag tone="success">{item.score}</Tag>
              </div>
              <div className="home-mock__lead-title">{item.title}</div>
              <div className="home-mock__lead-meta">{item.meta}</div>
              {item.reason ? <div className="home-mock__lead-reason">{item.reason}</div> : null}
              {item.action ? (
                <div className="home-mock__lead-action">
                  <Mail aria-hidden size={13} />
                  {item.action}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </div>
      <div className="home-mock__float">
        <span className="home-mock__float-icon">
          <Globe aria-hidden size={18} />
        </span>
        <div>
          <div className="home-mock__float-title">{mock.site}</div>
          <div className="home-mock__float-meta">
            <Tag tone="success">{mock.siteStatus}</Tag>
            <span className="home-mock__float-inquiry">
              <Inbox aria-hidden size={12} />
              {mock.inquiries}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
