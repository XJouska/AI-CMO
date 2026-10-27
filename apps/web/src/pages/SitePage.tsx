import { EmptyPage, NavBar } from '@yb/generated/components'
import { useNavigate } from 'react-router-dom'
import { TabPage } from '@/components/local/TabPage'
import { t } from '@/i18n'

export function SitePage() {
  const navigate = useNavigate()
  return (
    <TabPage
      nav={
        <NavBar barType="Fixed Color Bg" divider={false} leftButton={false} rightButton={false} themeBg={false}>
          {t.site.title}
        </NavBar>
      }
      surface="secondary"
    >
      <div className="page-empty">
        <EmptyPage
          buttonLabel={t.site.emptyAction}
          descText={t.site.emptyDesc}
          illus="placeholder"
          onAction={(action) => {
            if (action === 'press') navigate('/assistant')
          }}
        >
          {t.site.emptyTitle}
        </EmptyPage>
      </div>
    </TabPage>
  )
}
