import { useQuery } from '@tanstack/react-query'
import { ListSectionTitle, NavBar, SettingsFullWidthItem } from '@yb/generated/components'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '@/api/endpoints'
import { leadsApi } from '@/leads/api'
import { TabPage } from '@/components/local/TabPage'
import { BRAND } from '@/brand'
import { ChoiceSheet, ConfirmDialog } from '@/feedback/overlays'
import { useToast } from '@/feedback/toast'
import { t } from '@/i18n'
import { useSession } from '@/session/session'

interface MeItem {
  id: string
  label: string
  value: string
  onOpen: () => void
}

export function MePage() {
  const navigate = useNavigate()
  const toast = useToast()
  const session = useSession()
  const [switching, setSwitching] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)
  const profile = useQuery({ queryKey: ['profile', session.company?.id], queryFn: api.profile })
  const watches = useQuery({ queryKey: ['watches', session.company?.id], queryFn: leadsApi.watches })

  const soon = () => toast.show(t.common.comingSoon)
  const companies = session.user?.companies ?? []
  const sections: { title: string; items: MeItem[] }[] = [
    {
      title: t.me.sectionCompany,
      items: [
        {
          id: 'profile',
          label: t.me.profile,
          value: profile.data ? t.profile.completeness(profile.data.completeness) : t.common.loading,
          onOpen: () => navigate('/me/profile'),
        },
        {
          id: 'products',
          label: t.me.products,
          value: profile.data ? t.me.countValue(profile.data.product_count) : t.common.loading,
          onOpen: () => navigate('/me/products'),
        },
        { id: 'assets', label: t.me.assets, value: t.me.manage, onOpen: () => navigate('/me/assets') },
        { id: 'team', label: t.me.team, value: t.me.manage, onOpen: () => navigate('/me/members') },
      ],
    },
    {
      title: t.me.sectionGrowth,
      items: [
        {
          id: 'monitoring',
          label: t.me.monitoring,
          value: watches.data?.some((w) => w.is_active) ? t.leads.watchDaily : t.me.monitoringValue,
          onOpen: () => navigate('/me/watches'),
        },
        { id: 'signature', label: t.me.signature, value: t.me.notSet, onOpen: soon },
      ],
    },
    {
      title: t.me.sectionAccount,
      items: [
        { id: 'plan', label: t.me.plan, value: t.me.planValue, onOpen: soon },
        { id: 'switch', label: t.me.switchCompany, value: session.company?.name_cn ?? '', onOpen: () => setSwitching(true) },
        { id: 'about', label: t.me.about, value: `v${BRAND.version}`, onOpen: () => {} },
      ],
    },
  ]

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
        {sections.map((section) => (
          <section key={section.title}>
            <ListSectionTitle>{section.title}</ListSectionTitle>
            {section.items.map((item) => (
              <SettingsFullWidthItem
                key={item.id}
                onAction={(action) => action === 'open' && item.onOpen()}
                trailing={item.value}
                trailingKind="chevron"
                type="单行列表-常规"
              >
                {item.label}
              </SettingsFullWidthItem>
            ))}
          </section>
        ))}
        <section className="me-logout">
          <SettingsFullWidthItem onAction={(action) => action === 'press' && setLoggingOut(true)} type="居中按钮-敏感操作">
            {t.me.logout}
          </SettingsFullWidthItem>
        </section>
      </div>
      <ChoiceSheet
        cancelLabel={t.common.cancel}
        description={t.company.switchTitle}
        items={[...companies.map((c) => (c.id === session.company?.id ? `${c.name_cn} ✓` : c.name_cn)), t.company.createTitle]}
        label={t.company.switchTitle}
        onCancel={() => setSwitching(false)}
        onSelect={(index) => {
          setSwitching(false)
          const target = companies[index]
          if (!target) return navigate('/onboarding/company')
          if (target.id !== session.company?.id) {
            session.selectCompany(target.id)
            toast.show(t.company.switched(target.name_cn))
          }
        }}
        open={switching}
      />
      <ConfirmDialog
        cancelLabel={t.common.cancel}
        confirmLabel={t.me.logout}
        danger
        onCancel={() => setLoggingOut(false)}
        onConfirm={() => {
          setLoggingOut(false)
          void api.logout().catch(() => {})
          session.signOut()
          navigate('/login', { replace: true })
        }}
        open={loggingOut}
        title={t.me.logoutConfirm}
      />
    </TabPage>
  )
}
