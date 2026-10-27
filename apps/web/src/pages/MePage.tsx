import { ListSectionTitle, NavBar, SettingsFullWidthItem } from '@yb/generated/components'
import { TabPage } from '@/components/local/TabPage'
import { BRAND } from '@/brand'
import { useToast } from '@/feedback/toast'
import { t } from '@/i18n'

// 计划 01 只放占位列表；各项在计划 02 / 05 / 07 中接入真实页面。
// 使用 Settings/fullWidthItem（右侧描述文本可配置），不使用 Settings/items（右侧文案写死为「选项」并带红点）。
const SECTIONS = [
  {
    title: t.me.sectionAccount,
    items: [
      { id: 'profile', label: t.me.profile, value: t.me.profileValue },
      { id: 'monitoring', label: t.me.monitoring, value: t.me.monitoringValue },
      { id: 'team', label: t.me.team, value: t.me.teamValue },
    ],
  },
  {
    title: t.me.sectionPlan,
    items: [
      { id: 'plan', label: t.me.plan, value: t.me.planValue },
      { id: 'about', label: t.me.about, value: `v${BRAND.version}` },
    ],
  },
] as const

export function MePage() {
  const toast = useToast()
  return (
    <TabPage
      nav={
        <NavBar barType="Fixed Color Bg" divider={false} leftButton={false} rightButton={false} themeBg={false}>
          {t.me.title}
        </NavBar>
      }
      surface="secondary"
    >
      <div className="me-list">
        {SECTIONS.map((section) => (
          <section key={section.title}>
            <ListSectionTitle>{section.title}</ListSectionTitle>
            {section.items.map((item) => (
              <SettingsFullWidthItem
                key={item.id}
                onAction={(action) => {
                  if (action === 'open') toast.show(t.me.comingSoon)
                }}
                trailing={item.value}
                trailingKind="chevron"
                type="单行列表-常规"
              >
                {item.label}
              </SettingsFullWidthItem>
            ))}
          </section>
        ))}
      </div>
    </TabPage>
  )
}
