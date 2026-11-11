// 我的资料：按类别展示上传的照片和文件（随时补传）、开通时填写的内容；账号、密码、套餐、消息收在页面底部。
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
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
import { Card, Centered, ConfirmDialog, FormModal, ListGroup, ListRow, Spinner, TextArea, TextField, useToast } from '@/ui'
import { useErrorToast } from '@/feedback/useErrorToast'

export function MaterialsPage() {
  const session = useSession()
  const navigate = useNavigate()
  const overview = useOverview()
  const assets = useAssets()
  const styles = useQuery({ queryKey: ['site-styles'], queryFn: serviceApi.styles, staleTime: Infinity })
  const notifications = useQuery({ queryKey: ['notifications', session.company?.id], queryFn: notificationsApi.list })
  const [loggingOut, setLoggingOut] = useState(false)
  const [editing, setEditing] = useState(false)
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
          <ListGroup title={cust.materials.note}>
            <ListRow onClick={() => setEditing(true)} subtitle={data.buyers.business || '—'} title={cust.materials.business} trailing={<PencilLine aria-hidden size={16} />} />
            <ListRow onClick={() => setEditing(true)} subtitle={data.buyers.target_markets || cust.home.anyMarket} title={cust.materials.markets} trailing={<PencilLine aria-hidden size={16} />} />
            <ListRow onClick={() => navigate('/start')} title={cust.materials.style} trailing={<PencilLine aria-hidden size={16} />} value={styleName} />
          </ListGroup>

          <h2 className="cust-section-title">{cust.materials.photos}</h2>
          <MaterialChecklist categories={data.categories} counts={data.materials} />
          <MaterialList assets={assets.data} categories={data.categories} />

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
      {data ? <BusinessEditor initial={data.buyers} onClose={() => setEditing(false)} open={editing} /> : null}
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

/** 修改「做什么产品 / 想卖到哪里」：保存后 AI 重新整理产品，找买家计划随之更新。 */
function BusinessEditor({ open, onClose, initial }: { open: boolean; onClose: () => void; initial: { business: string; target_markets: string } }) {
  const toast = useToast()
  const showError = useErrorToast()
  const queryClient = useQueryClient()
  const [business, setBusiness] = useState(initial.business)
  const [markets, setMarkets] = useState(initial.target_markets)
  const save = useMutation({
    mutationFn: () => serviceApi.submitBusiness({ business: business.trim(), target_markets: markets.trim() }),
    onSuccess: async () => {
      toast.show(cust.start.buyersStarted)
      onClose()
      await queryClient.invalidateQueries({ queryKey: ['service-overview'] })
    },
    onError: showError,
  })
  return (
    <FormModal
      loading={save.isPending}
      onClose={onClose}
      onPrimary={() => save.mutate()}
      onSecondary={onClose}
      open={open}
      primaryDisabled={business.trim().length < 2}
      primaryLabel="保存"
      secondaryLabel="取消"
      title={cust.materials.business}
    >
      <TextArea hint={cust.start.businessHint} label={cust.start.businessLabel} maxLength={1000} onChange={setBusiness} placeholder={cust.start.businessPlaceholder} rows={3} value={business} />
      <TextField label={cust.start.marketsLabel} maxLength={300} onChange={setMarkets} placeholder={cust.start.marketsPlaceholder} value={markets} />
    </FormModal>
  )
}
