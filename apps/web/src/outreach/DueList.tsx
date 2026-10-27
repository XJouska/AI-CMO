// 「商机」Tab 的「待跟进」分类：按下一步时间排序，逾期项用正式列表的红点（showDot，红色 Token）标出。
import { useQuery } from '@tanstack/react-query'
import { EmptyPage, SettingsFullWidthItem } from '@yb/generated/components'
import { useNavigate } from 'react-router-dom'
import { QueryView } from '@/components/local/QueryView'
import { PageCenter } from '@/components/local/StackPage'
import { t } from '@/i18n'
import { useSession } from '@/session/session'
import { outreachApi, shortTime } from './api'

export function DueList() {
  const navigate = useNavigate()
  const session = useSession()
  const due = useQuery({ queryKey: ['follow-ups-due', session.company?.id], queryFn: outreachApi.due })
  return (
    <QueryView query={due}>
      {(items) =>
        items.length ? (
          <div className="due-list">
            {items.map((item) => (
              <div className="due-item" data-lead-id={item.lead_id} data-overdue={item.pipeline.overdue || undefined} key={item.lead_id}>
                <SettingsFullWidthItem
                  onAction={(a) => a === 'open' && navigate(`/leads/${item.lead_id}`)}
                  subtitle={[item.pipeline.stage_label, item.pipeline.next_action].filter(Boolean).join(' · ')}
                  showDot={item.pipeline.overdue}
                  trailing={t.outreach.dueAt(shortTime(item.pipeline.next_action_at), item.pipeline.overdue)}
                  trailingKind="chevron"
                  type="双行列表-常规"
                >
                  {item.title}
                </SettingsFullWidthItem>
              </div>
            ))}
          </div>
        ) : (
          <PageCenter>
            <EmptyPage button={false} descText={t.outreach.dueEmptyDesc} illus="noContent">
              {t.outreach.dueEmptyTitle}
            </EmptyPage>
          </PageCenter>
        )
      }
    </QueryView>
  )
}
