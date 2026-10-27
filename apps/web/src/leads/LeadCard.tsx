// 商机卡片：正式 Card（Output）+ Tag（类型 / 分数）+ BadgeDot（新商机）。不自绘外观。
import { BadgeDot, Card, Tag } from '@yb/generated/components'
import { Icon } from '@yb/library/Icon'
import { t } from '@/i18n'
import type { LeadOut, LeadType } from './api'

// 类型图标取自正式图标库（19817 系列）。注意：vendored SVG 的文件与图标名并非一一对应，按实际图形选择。
const TYPE_ICON: Record<LeadType, { name: string; nodeId: string }> = {
  tender: { name: 'Icon/Industry Brief', nodeId: '19817:55170' },
  rfq: { name: 'Icon/Health', nodeId: '19817:55225' },
  buyer_intent: { name: 'Icon/Search', nodeId: '19817:55201' },
  prospect: { name: 'Icon/Team Management', nodeId: '19817:55302' },
  site_inquiry: { name: 'Icon/Feedback', nodeId: '19817:55216' },
}

export function leadMeta(lead: Pick<LeadOut, 'market' | 'deadline' | 'buyer'>): string {
  return [lead.buyer?.name, lead.market, lead.deadline ? t.leads.deadline(lead.deadline) : ''].filter(Boolean).join(' · ')
}

export function LeadCard({ lead, onOpen }: { lead: LeadOut; onOpen: () => void }) {
  return (
    // 用外层 click 打开详情：Card 在 pointercancel（滚动）时也会发 press-end，直接用会误触跳转。
    <div
      aria-label={lead.title}
      className="lead-card"
      data-lead-id={lead.id}
      role="link"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onOpen()
        }
      }}
    >
      <Card
        card="Output"
        leftSlot={<Icon decorative {...TYPE_ICON[lead.type]} size={20} />}
        content={
          <span className="lead-card-body">
            <span className="lead-card-tags">
              <Tag showIcon={false} type="Default">
                {t.leads.types[lead.type]}
              </Tag>
              <Tag showIcon={false} type="Badge">
                {t.leads.score(lead.score)}
              </Tag>
              {lead.is_new ? <BadgeDot /> : null}
            </span>
            <span className="lead-card-meta">{leadMeta(lead)}</span>
            {lead.summary_cn ? <span className="lead-card-summary">{lead.summary_cn}</span> : null}
          </span>
        }
      >
        {lead.title}
      </Card>
    </div>
  )
}
