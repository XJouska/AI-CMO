// 「商机 → 跟进」：按下一步时间排序，逾期项标红。
import { useQuery } from '@tanstack/react-query'
import { CalendarClock } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { QueryView } from '@/components/QueryView'
import { t } from '@/i18n'
import { useSession } from '@/session/session'
import { Centered, EmptyState, ListRow, Tag } from '@/ui'
import { outreachApi, shortTime } from './api'

export function DueList() {
  const navigate = useNavigate()
  const session = useSession()
  const due = useQuery({ queryKey: ['follow-ups-due', session.company?.id], queryFn: outreachApi.due })
  return (
    <QueryView query={due}>
      {(items) =>
        items.length ? (
          <div className="ui-list due-list">
            {items.map((item) => (
              <ListRow
                data={{ 'lead-id': item.lead_id, overdue: item.pipeline.overdue || undefined }}
                key={item.lead_id}
                onClick={() => navigate(`/leads/${item.lead_id}`)}
                subtitle={[item.pipeline.stage_label, item.pipeline.next_action].filter(Boolean).join(' · ')}
                title={item.title}
                trailing={
                  <Tag tone={item.pipeline.overdue ? 'danger' : 'neutral'}>{t.outreach.dueAt(shortTime(item.pipeline.next_action_at), item.pipeline.overdue)}</Tag>
                }
              />
            ))}
          </div>
        ) : (
          <Centered>
            <EmptyState description={t.outreach.dueEmptyDesc} icon={CalendarClock} title={t.outreach.dueEmptyTitle} />
          </Centered>
        )
      }
    </QueryView>
  )
}
