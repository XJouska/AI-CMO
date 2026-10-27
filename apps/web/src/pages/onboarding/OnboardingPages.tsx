// 建档引导：创建企业 → 选择建档方式（网址 / 上传资料 / 和助手聊）→ AI 抽取进度 → 确认变更。
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Button, FormDoubleLine, FormSingleLine, ListSectionTitle, Markdown, SettingsFullWidthItem } from '@yb/generated/components'
import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, type Asset, type AssetKind } from '@/api/endpoints'
import { StackPage } from '@/components/local/StackPage'
import { useToast } from '@/feedback/toast'
import { useErrorToast } from '@/feedback/useErrorToast'
import { t } from '@/i18n'
import { normalizeUrl } from '@/lib/validation'
import { useSession } from '@/session/session'

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024
export const ACCEPTED_FILES = 'image/jpeg,image/png,image/webp,application/pdf'

export function CreateCompanyPage() {
  const navigate = useNavigate()
  const session = useSession()
  const toast = useToast()
  const showError = useErrorToast()
  const [nameCn, setNameCn] = useState('')
  const [nameEn, setNameEn] = useState('')
  const mutation = useMutation({
    mutationFn: () => api.createCompany({ name_cn: nameCn.trim(), name_en: nameEn.trim() }),
    onSuccess: async (company) => {
      await session.refresh()
      session.selectCompany(company.id)
      navigate('/onboarding', { replace: true })
    },
    onError: showError,
  })
  const complete = nameCn.trim() !== ''
  function submit() {
    if (!complete || mutation.isPending) return
    if (nameCn.trim().length < 2) return toast.show(t.company.nameTooShort)
    mutation.mutate()
  }
  return (
    <StackPage
      footer={
        <Button onAction={(a) => a === 'press' && submit()} size="L" state={complete && !mutation.isPending ? 'Default' : 'Disable'} type="Primary">
          {t.company.create}
        </Button>
      }
      noBack={!session.company}
      surface="primary"
      title={t.company.createTitle}
    >
      <div className="form-stack">
        <FormSingleLine align="left" label={t.company.nameCn} maxLength={100} onChange={setNameCn} placeholder={t.company.nameCnPlaceholder} value={nameCn} />
        <FormSingleLine align="left" label={t.company.nameEn} maxLength={150} onChange={setNameEn} placeholder={t.company.nameEnPlaceholder} value={nameEn} />
      </div>
    </StackPage>
  )
}

export function OnboardingPage() {
  const navigate = useNavigate()
  const options = [
    { id: 'url', label: t.onboarding.url, desc: t.onboarding.urlDesc, hint: t.onboarding.urlHint, to: '/onboarding/url' },
    { id: 'files', label: t.onboarding.files, desc: t.onboarding.filesDesc, hint: t.onboarding.filesHint, to: '/onboarding/files' },
    { id: 'chat', label: t.onboarding.chat, desc: t.onboarding.chatDesc, hint: t.onboarding.chatHint, to: '/onboarding/chat' },
  ]
  return (
    <StackPage
      footer={
        <Button onAction={(a) => a === 'press' && navigate('/assistant')} size="L" type="Text">
          {t.onboarding.skip}
        </Button>
      }
      noBack
      title={t.onboarding.title}
    >
      <div className="content-inset">
        <Markdown variant="Body">
          <p>{t.onboarding.intro}</p>
        </Markdown>
      </div>
      {options.map((option) => (
        <SettingsFullWidthItem
          key={option.id}
          onAction={(action) => action === 'open' && navigate(option.to)}
          subtitle={option.desc}
          trailing={option.hint}
          trailingKind="chevron"
          type="双行列表-常规"
        >
          {option.label}
        </SettingsFullWidthItem>
      ))}
    </StackPage>
  )
}

function useStartExtraction() {
  const navigate = useNavigate()
  const showError = useErrorToast()
  return useMutation({
    mutationFn: api.createExtraction,
    onSuccess: (extraction) => navigate(`/extractions/${extraction.id}`, { replace: true }),
    onError: showError,
  })
}

export function OnboardingUrlPage() {
  const toast = useToast()
  const [url, setUrl] = useState('')
  const start = useStartExtraction()
  function submit() {
    if (!url.trim() || start.isPending) return
    const normalized = normalizeUrl(url)
    if (!normalized) return toast.show(t.onboarding.urlInvalid)
    start.mutate({ source: 'url', url: normalized })
  }
  return (
    <StackPage
      footer={
        <Button onAction={(a) => a === 'press' && submit()} size="L" state={url.trim() && !start.isPending ? 'Default' : 'Disable'} type="Primary">
          {t.onboarding.start}
        </Button>
      }
      surface="primary"
      title={t.onboarding.urlTitle}
    >
      <div className="form-stack">
        <FormSingleLine align="left" label={t.onboarding.urlLabel} maxLength={2048} onChange={setUrl} placeholder={t.onboarding.urlPlaceholder} value={url} />
      </div>
    </StackPage>
  )
}

export function OnboardingChatPage() {
  const toast = useToast()
  const [text, setText] = useState('')
  const start = useStartExtraction()
  function submit() {
    if (!text.trim() || start.isPending) return
    if (text.trim().length < 10) return toast.show(t.onboarding.textTooShort)
    start.mutate({ source: 'chat', text: text.trim() })
  }
  return (
    <StackPage
      footer={
        <Button onAction={(a) => a === 'press' && submit()} size="L" state={text.trim() && !start.isPending ? 'Default' : 'Disable'} type="Primary">
          {t.onboarding.start}
        </Button>
      }
      surface="primary"
      title={t.onboarding.chatTitle}
    >
      <div className="form-stack">
        <FormDoubleLine label={t.onboarding.chatLabel} maxLength={10000} onChange={setText} placeholder={t.onboarding.chatPlaceholder} value={text} />
      </div>
    </StackPage>
  )
}

/** 隐藏的原生文件选择框 + 正式按钮触发。上传前在前端检查大小，真实类型由后端按文件头校验。 */
export function useFilePicker(kind: AssetKind, onUploaded: (asset: Asset) => void) {
  const input = useRef<HTMLInputElement>(null)
  const toast = useToast()
  const showError = useErrorToast()
  const queryClient = useQueryClient()
  const [uploading, setUploading] = useState(false)

  async function upload(files: FileList | null) {
    if (!files?.length) return
    setUploading(true)
    try {
      for (const file of Array.from(files)) {
        if (file.size > MAX_UPLOAD_BYTES) {
          toast.show(t.assets.tooLarge)
          continue
        }
        try {
          onUploaded(await api.uploadAsset(file, kind))
        } catch (error) {
          showError(error)
        }
      }
      await queryClient.invalidateQueries({ queryKey: ['assets'] })
    } finally {
      setUploading(false)
      if (input.current) input.current.value = ''
    }
  }

  const element = (
    <input
      accept={ACCEPTED_FILES}
      hidden
      multiple
      onChange={(event) => void upload(event.target.files)}
      ref={input}
      type="file"
    />
  )
  return { element, open: () => input.current?.click(), uploading }
}

export function OnboardingFilesPage() {
  const [uploaded, setUploaded] = useState<Asset[]>([])
  const start = useStartExtraction()
  const picker = useFilePicker('catalog', (asset) => setUploaded((prev) => [...prev, asset]))
  const ready = uploaded.length > 0 && !picker.uploading && !start.isPending
  return (
    <StackPage
      footer={
        <div className="form-actions">
          <Button onAction={(a) => a === 'press' && picker.open()} size="L" state={picker.uploading ? 'Disable' : 'Default'} type="Secondary">
            {picker.uploading ? t.onboarding.uploading : t.onboarding.chooseFiles}
          </Button>
          <Button
            onAction={(a) => a === 'press' && ready && start.mutate({ source: 'file', asset_ids: uploaded.map((asset) => asset.id) })}
            size="L"
            state={ready ? 'Default' : 'Disable'}
            type="Primary"
          >
            {t.onboarding.start}
          </Button>
        </div>
      }
      title={t.onboarding.filesTitle}
    >
      {picker.element}
      <ListSectionTitle>{uploaded.length ? t.onboarding.uploaded(uploaded.length) : t.onboarding.noFiles}</ListSectionTitle>
      {uploaded.map((asset) => (
        <SettingsFullWidthItem key={asset.id} trailing={t.assets.size(asset.size)} trailingKind="none" type="单行列表-常规">
          {asset.display_name}
        </SettingsFullWidthItem>
      ))}
      <div className="content-inset">
        <Markdown variant="Body">
          <p>{t.onboarding.filesDesc}</p>
        </Markdown>
      </div>
    </StackPage>
  )
}
