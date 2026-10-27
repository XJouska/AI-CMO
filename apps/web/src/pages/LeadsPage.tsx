import { EmptyPage, NavBar } from '@yb/generated/components'
import { TabPage } from '@/components/local/TabPage'
import { t } from '@/i18n'

export function LeadsPage() {
  return (
    <TabPage
      nav={
        <NavBar barType="Fixed Color Bg" divider={false} leftButton={false} rightButton={false} themeBg>
          {t.leads.title}
        </NavBar>
      }
      surface="primary"
    >
      <div className="page-empty">
        <EmptyPage button={false} descText={t.leads.emptyDesc} illus="noContent">
          {t.leads.emptyTitle}
        </EmptyPage>
      </div>
    </TabPage>
  )
}
