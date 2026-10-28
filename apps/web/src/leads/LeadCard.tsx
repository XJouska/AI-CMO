// 商机卡片：类型图标、标题、标签（类型 / 分数 / 新）、买家 · 市场 · 截止、中文摘要。整卡可点击进入详情。
import { Building2, FileSearch, Gavel, Inbox, MessageSquareQuote, type LucideIcon } from 'lucide-react'
import { t } from '@/i18n'
import { cx, Tag, type Tone } from '@/ui'
import type { LeadOut, LeadType } from './api'

export const LEAD_TYPE_ICON: Record<LeadType, LucideIcon> = {
  tender: Gavel,
  rfq: FileSearch,
  buyer_intent: MessageSquareQuote,
  prospect: Building2,
  site_inquiry: Inbox,
}

export function leadMeta(lead: Pick<LeadOut, 'market' | 'deadline' | 'buyer'>): string {
  return [lead.buyer?.name, lead.market, lead.deadline ? t.leads.deadline(lead.deadline) : ''].filter(Boolean).join(' · ')
}

export function scoreTone(score: number): Tone {
  if (score >= 80) return 'success'
  if (score >= 60) return 'accent'
  return 'neutral'
}

export function LeadCard({ lead, onOpen }: { lead: LeadOut; onOpen: () => void }) {
  const Icon = LEAD_TYPE_ICON[lead.type]
  return (
    <div
      aria-label={lead.title}
      className={cx('lead-card', lead.is_new && 'is-new')}
      data-lead-id={lead.id}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onOpen()
        }
      }}
      role="link"
      tabIndex={0}
    >
      <div className="lead-card__head">
        <span aria-hidden className="lead-card__icon">
          <Icon size={18} />
        </span>
        <div className="lead-card__tags">
          <Tag>{t.leads.types[lead.type]}</Tag>
          <Tag tone={scoreTone(lead.score)}>{t.leads.score(lead.score)}</Tag>
          {lead.is_new ? <Tag tone="danger">{t.leads.newTag}</Tag> : null}
        </div>
      </div>
      <h3 className="lead-card__title">{lead.title}</h3>
      {leadMeta(lead) ? <p className="lead-card__meta">{leadMeta(lead)}</p> : null}
      {lead.summary_cn ? <p className="lead-card__summary">{lead.summary_cn}</p> : null}
    </div>
  )
}
