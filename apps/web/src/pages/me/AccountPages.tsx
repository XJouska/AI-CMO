// 资质与资料、团队成员、接受邀请。
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FileText, FolderOpen, Link2Off, Trash2, Upload, UserPlus, UserRound } from 'lucide-react'
import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { api, type Asset, type AssetKind, type Member, type Role } from '@/api/endpoints'
import { QueryView } from '@/components/QueryView'
import { useErrorToast } from '@/feedback/useErrorToast'
import { t } from '@/i18n'
import { AuthCard } from '@/layout/AuthLayout'
import { SettingsPage } from '@/layout/SettingsPage'
import { useSession } from '@/session/session'
import { Button, ChoiceMenu, ConfirmDialog, EmptyState, IconButton, ListRow, Tag, useToast } from '@/ui'
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
    <SettingsPage
      actions={
        query.data?.length ? (
          <Button icon={Upload} loading={picker.uploading} onClick={upload} variant="primary">
            {t.assets.upload}
          </Button>
        ) : null
      }
      title={t.assets.title}
    >
      {picker.element}
      <QueryView empty={{ title: t.assets.emptyTitle, desc: t.assets.emptyDesc, action: t.assets.upload, onAction: upload, icon: FolderOpen }} isEmpty={(items) => items.length === 0} query={query}>
        {(items) => (
          <div className="ui-list">
            {items.map((asset) => (
              <ListRow
                icon={FileText}
                key={asset.id}
                onClick={() => void openAsset(asset)}
                subtitle={`${KIND_LABEL[asset.kind]} · ${t.assets.size(asset.size)}`}
                title={asset.display_name}
                trailing={<IconButton icon={Trash2} label={t.common.delete} onClick={() => setDeleting(asset)} size="sm" />}
              />
            ))}
          </div>
        )}
      </QueryView>
      <ChoiceMenu
        cancelLabel={t.common.cancel}
        items={UPLOAD_KINDS.map((k) => ({ label: KIND_LABEL[k] }))}
        onCancel={() => setChoosing(false)}
        onSelect={(index) => {
          setChoosing(false)
          setKind(UPLOAD_KINDS[index])
          // 等待 kind 状态生效后再打开文件选择框
          window.setTimeout(picker.open, 0)
        }}
        open={choosing}
        title={t.assets.chooseKind}
      />
      <ConfirmDialog
        body={deleting?.display_name}
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
    </SettingsPage>
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
  const isOwner = session.company?.role === 'owner'
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
    <SettingsPage
      actions={
        canManage ? (
          <Button icon={UserPlus} loading={invite.isPending} onClick={() => invite.mutate()} variant="primary">
            {t.members.invite}
          </Button>
        ) : null
      }
      title={t.members.title}
    >
      <QueryView query={query}>
        {(members) => (
          <div className="ui-list">
            {members.map((member) => (
              <ListRow
                icon={UserRound}
                key={member.user_id}
                subtitle={member.email}
                title={`${member.name || member.email}${member.is_me ? t.members.me : ''}`}
                trailing={
                  <>
                    <Tag tone={member.role === 'owner' ? 'accent' : 'neutral'}>{ROLE_LABEL[member.role]}</Tag>
                    {isOwner && member.role !== 'owner' ? <IconButton icon={Link2Off} label={t.members.remove} onClick={() => setRemoving(member)} size="sm" /> : null}
                  </>
                }
              />
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
        confirmLabel={t.members.remove}
        danger
        onCancel={() => setRemoving(null)}
        onConfirm={() => {
          if (removing) remove.mutate(removing.user_id)
          setRemoving(null)
        }}
        open={removing !== null}
        title={removing ? t.members.removeConfirm(removing.name || removing.email) : ''}
      />
    </SettingsPage>
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
    <AuthCard title={t.invite.title}>
      {preview.isError ? (
        <EmptyState icon={Link2Off} title={t.invite.invalid} />
      ) : (
        <QueryView query={preview}>
          {(info) => (
            <div className="stack">
              <p className="secondary">{t.invite.desc(info.company_name)}</p>
              <Button block loading={accept.isPending} onClick={() => accept.mutate()} size="lg" variant="primary">
                {t.invite.accept}
              </Button>
            </div>
          )}
        </QueryView>
      )}
    </AuthCard>
  )
}
