// 资质与资料、团队成员、接受邀请。
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, EmptyPage, Markdown, SettingsFullWidthItem } from '@yb/generated/components'
import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { api, type Asset, type AssetKind, type Member, type Role } from '@/api/endpoints'
import { QueryView } from '@/components/local/QueryView'
import { PageCenter, StackPage } from '@/components/local/StackPage'
import { ChoiceSheet, ConfirmDialog } from '@/feedback/overlays'
import { useToast } from '@/feedback/toast'
import { useErrorToast } from '@/feedback/useErrorToast'
import { t } from '@/i18n'
import { useSession } from '@/session/session'
import { useFilePicker } from '../onboarding/OnboardingPages'

const KIND_LABEL: Record<AssetKind, string> = {
  image: t.assets.kindImage,
  certificate: t.assets.kindCertificate,
  catalog: t.assets.kindCatalog,
  pdf: t.assets.kindPdf,
}
const UPLOAD_KINDS: AssetKind[] = ['certificate', 'catalog', 'image']

export function AssetsPage() {
  const session = useSession()
  const showError = useErrorToast()
  const toast = useToast()
  const queryClient = useQueryClient()
  const query = useQuery({ queryKey: ['assets', session.company?.id], queryFn: () => api.assets() })
  const [kind, setKind] = useState<AssetKind>('certificate')
  const [choosing, setChoosing] = useState(false)
  const [action, setAction] = useState<Asset | null>(null)
  const [deleting, setDeleting] = useState<Asset | null>(null)
  const picker = useFilePicker(kind, () => {})

  const remove = useMutation({
    mutationFn: (id: string) => api.deleteAsset(id),
    onSuccess: async () => {
      toast.show(t.common.deleted)
      await queryClient.invalidateQueries({ queryKey: ['assets'] })
    },
    onError: showError,
  })

  async function openAsset(asset: Asset) {
    try {
      const { url } = await api.assetUrl(asset.id)
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch (error) {
      showError(error)
    }
  }

  const upload = () => setChoosing(true)
  return (
    <StackPage
      backTo="/me"
      footer={
        query.data?.length ? (
          <Button onAction={(a) => a === 'press' && upload()} size="L" state={picker.uploading ? 'Disable' : 'Default'} type="Primary">
            {picker.uploading ? t.onboarding.uploading : t.assets.upload}
          </Button>
        ) : undefined
      }
      title={t.assets.title}
    >
      {picker.element}
      <QueryView
        empty={{ title: t.assets.emptyTitle, desc: t.assets.emptyDesc, action: t.assets.upload, onAction: upload }}
        isEmpty={(items) => items.length === 0}
        query={query}
      >
        {(items) => (
          <div className="list-block">
            {items.map((asset) => (
              <SettingsFullWidthItem
                key={asset.id}
                onAction={(a) => a === 'open' && setAction(asset)}
                subtitle={`${KIND_LABEL[asset.kind]} · ${t.assets.size(asset.size)}`}
                trailingKind="more"
                type="双行列表-常规"
              >
                {asset.display_name}
              </SettingsFullWidthItem>
            ))}
          </div>
        )}
      </QueryView>
      <ChoiceSheet
        cancelLabel={t.common.cancel}
        description={t.assets.chooseKind}
        items={UPLOAD_KINDS.map((k) => KIND_LABEL[k])}
        label={t.assets.chooseKind}
        onCancel={() => setChoosing(false)}
        onSelect={(index) => {
          setChoosing(false)
          setKind(UPLOAD_KINDS[index])
          // 等待 kind 状态生效后再打开文件选择框
          window.setTimeout(picker.open, 0)
        }}
        open={choosing}
      />
      <ChoiceSheet
        cancelLabel={t.common.cancel}
        description={action?.display_name}
        items={[t.assets.open, t.common.delete]}
        label={action?.display_name ?? ''}
        onCancel={() => setAction(null)}
        onSelect={(index) => {
          const target = action
          setAction(null)
          if (!target) return
          if (index === 0) void openAsset(target)
          else setDeleting(target)
        }}
        open={action !== null}
      />
      <ConfirmDialog
        cancelLabel={t.common.cancel}
        confirmLabel={t.common.delete}
        danger
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          if (deleting) remove.mutate(deleting.id)
          setDeleting(null)
        }}
        open={deleting !== null}
        title={t.assets.deleteConfirm}
      />
    </StackPage>
  )
}

const ROLE_LABEL: Record<Role, string> = { owner: t.members.roleOwner, member: t.members.roleMember, operator: t.members.roleOperator }

export function inviteLink(token: string, origin = window.location.origin): string {
  return `${origin}/invite/${encodeURIComponent(token)}`
}

export function MembersPage() {
  const session = useSession()
  const toast = useToast()
  const showError = useErrorToast()
  const queryClient = useQueryClient()
  const companyId = session.company?.id ?? ''
  const canManage = session.company?.role === 'owner' || session.company?.role === 'operator'
  const query = useQuery({ queryKey: ['members', companyId], queryFn: () => api.members(companyId), enabled: Boolean(companyId) })
  const [link, setLink] = useState<string | null>(null)
  const [removing, setRemoving] = useState<Member | null>(null)

  const invite = useMutation({
    mutationFn: () => api.createInvite(companyId),
    onSuccess: (result) => setLink(inviteLink(result.token)),
    onError: showError,
  })
  const remove = useMutation({
    mutationFn: (userId: string) => api.removeMember(companyId, userId),
    onSuccess: async () => {
      toast.show(t.members.removed)
      await queryClient.invalidateQueries({ queryKey: ['members', companyId] })
    },
    onError: showError,
  })

  return (
    <StackPage
      backTo="/me"
      footer={
        canManage ? (
          <Button onAction={(a) => a === 'press' && !invite.isPending && invite.mutate()} size="L" state={invite.isPending ? 'Disable' : 'Default'} type="Primary">
            {t.members.invite}
          </Button>
        ) : undefined
      }
      title={t.members.title}
    >
      <QueryView query={query}>
        {(members) => (
          <div className="list-block">
            {members.map((member) => (
              <SettingsFullWidthItem
                key={member.user_id}
                onAction={(a) => a === 'open' && session.company?.role === 'owner' && member.role !== 'owner' && setRemoving(member)}
                subtitle={member.email}
                trailing={ROLE_LABEL[member.role]}
                trailingKind={session.company?.role === 'owner' && member.role !== 'owner' ? 'chevron' : 'none'}
                type="双行列表-常规"
              >
                {`${member.name || member.email}${member.is_me ? t.members.me : ''}`}
              </SettingsFullWidthItem>
            ))}
          </div>
        )}
      </QueryView>
      <ConfirmDialog
        body={link ? `${t.members.inviteDesc}\n${link}` : undefined}
        cancelLabel={t.common.cancel}
        confirmLabel={t.common.copy}
        onCancel={() => setLink(null)}
        onConfirm={() => {
          if (link) void navigator.clipboard?.writeText(link).then(() => toast.show(t.common.copied), () => {})
          setLink(null)
        }}
        open={link !== null}
        title={t.members.inviteTitle}
      />
      <ConfirmDialog
        cancelLabel={t.common.cancel}
        confirmLabel={t.common.delete}
        danger
        onCancel={() => setRemoving(null)}
        onConfirm={() => {
          if (removing) remove.mutate(removing.user_id)
          setRemoving(null)
        }}
        open={removing !== null}
        title={removing ? t.members.removeConfirm(removing.name || removing.email) : ''}
      />
    </StackPage>
  )
}

export function InviteAcceptPage() {
  const { token = '' } = useParams()
  const navigate = useNavigate()
  const session = useSession()
  const toast = useToast()
  const showError = useErrorToast()
  const preview = useQuery({ queryKey: ['invite', token], queryFn: () => api.previewInvite(token), retry: false })
  const accept = useMutation({
    mutationFn: () => api.acceptInvite(token),
    onSuccess: async (company) => {
      await session.refresh()
      session.selectCompany(company.id)
      toast.show(t.invite.joined(company.name_cn))
      navigate('/assistant', { replace: true })
    },
    onError: showError,
  })
  return (
    <StackPage noBack surface="primary" title={t.invite.title}>
      {preview.isError ? (
        <PageCenter>
          <EmptyPage button={false} descText="" description={false} illus="noContent">
            {t.invite.invalid}
          </EmptyPage>
        </PageCenter>
      ) : (
        <QueryView query={preview}>
          {(info) => (
            <div className="content-inset">
              <Markdown variant="H3">{t.invite.desc(info.company_name)}</Markdown>
              <div className="form-actions">
                <Button onAction={(a) => a === 'press' && !accept.isPending && accept.mutate()} size="L" state={accept.isPending ? 'Disable' : 'Default'} type="Primary">
                  {t.invite.accept}
                </Button>
              </div>
            </div>
          )}
        </QueryView>
      )}
    </StackPage>
  )
}
