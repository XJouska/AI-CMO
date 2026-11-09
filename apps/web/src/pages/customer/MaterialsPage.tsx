// 我的资料：按类别展示上传的照片和文件（随时补传）、开通时填写的内容；账号、密码、套餐、消息收在页面底部。
import { useQuery } from '@tanstack/react-query'
import { Bell, CreditCard, KeyRound, LogOut, PencilLine } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '@/api/endpoints'
import { cust } from '@/i18n/customer'
import { AppPage } from '@/layout/AppPage'
import { notificationsApi } from '@/ops/api'
import { useSession } from '@/session/session'
import { serviceApi } from '@/service/api'
import { MaterialChecklist, MaterialList, useAssets, useOverview } from '@/service/components'
import { Card, Centered, ConfirmDialog, ListGroup, ListRow, Spinner } from '@/ui'

export function MaterialsPage() {
  const session = useSession()
  const navigate = useNavigate()
  const overview = useOverview()
  const assets = useAssets()
  const styles = useQuery({ queryKey: ['site-styles'], queryFn: serviceApi.styles, staleTime: Infinity })
  const notifications = useQuery({ queryKey: ['notifications', session.company?.id], queryFn: notificationsApi.list })
  const [loggingOut, setLoggingOut] = useState(false)
  const unread = notifications.data?.filter((n) => !n.read).length ?? 0
  const data = overview.data
  const styleName =
    data?.style_choice === 'own' ? '按工厂自己的风格' : styles.data?.layouts.find((l) => l.key === data?.style_choice)?.label ?? cust.materials.styleNone

  return (
    <AppPage description={cust.materials.intro} title={cust.materials.title} width="narrow">
      {!data || !assets.data ? (
        <Centered>
          <Spinner />
        </Centered>
      ) : (
        <div className="stack-lg">
          <MaterialChecklist categories={data.categories} counts={data.materials} />
          <MaterialList assets={assets.data} categories={data.categories} />

          <ListGroup title={cust.materials.note}>
            <ListRow onClick={() => navigate('/start')} title={cust.materials.style} trailing={<PencilLine aria-hidden size={16} />} value={styleName} />
          </ListGroup>

          <ListGroup title={cust.materials.account}>
            <ListRow icon={KeyRound} onClick={() => navigate('/account/security')} subtitle={session.user?.email} title={cust.materials.security} chevron />
            <ListRow icon={CreditCard} onClick={() => navigate('/account/billing')} title={cust.materials.plan} chevron />
            <ListRow icon={Bell} onClick={() => navigate('/account/notifications')} title={cust.materials.notifications} value={unread ? `${unread} 条未读` : undefined} chevron />
            <ListRow danger icon={LogOut} onClick={() => setLoggingOut(true)} title={cust.materials.logout} />
          </ListGroup>
          <Card className="muted-card">
            <p className="muted">{session.company?.name_cn}</p>
          </Card>
        </div>
      )}
      <ConfirmDialog
        cancelLabel="取消"
        confirmLabel={cust.materials.logout}
        danger
        onCancel={() => setLoggingOut(false)}
        onConfirm={() => {
          setLoggingOut(false)
          void api.logout().catch(() => {})
          session.signOut()
          navigate('/login', { replace: true })
        }}
        open={loggingOut}
        title={cust.materials.logoutConfirm}
      />
    </AppPage>
  )
}
