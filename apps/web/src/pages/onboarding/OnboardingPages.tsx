// 建档引导：创建企业 → 选择建档方式（网址 / 上传资料 / 和助手聊）→ AI 抽取进度 → 确认变更。
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, FileUp, Globe, MessageSquareText, Upload } from 'lucide-react'
import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, type Asset, type AssetKind } from '@/api/endpoints'
import { useErrorToast } from '@/feedback/useErrorToast'
import { t } from '@/i18n'
import { AuthCard } from '@/layout/AuthLayout'
import { normalizeUrl } from '@/lib/validation'
import { useSession } from '@/session/session'
import { Button, ListGroup, ListRow, Tag, TextArea, TextField, useToast } from '@/ui'

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024
export const ACCEPTED_FILES = 'image/jpeg,image/png,image/webp,application/pdf'

const STEPS = t.onboarding.steps

function BackLink({ to }: { to?: string }) {
  const navigate = useNavigate()
  return (
    <Button icon={ArrowLeft} onClick={() => (to ? navigate(to) : navigate(-1))} size="sm" variant="ghost">
      {t.shell.back}
    </Button>
  )
}

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
    <AuthCard back={session.company ? <BackLink /> : undefined} steps={{ labels: STEPS, current: 0 }} title={t.company.createTitle}>
      <form
        className="ui-form-stack"
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <TextField label={t.company.nameCn} maxLength={100} onChange={setNameCn} placeholder={t.company.nameCnPlaceholder} value={nameCn} />
        <TextField label={t.company.nameEn} maxLength={150} onChange={setNameEn} placeholder={t.company.nameEnPlaceholder} value={nameEn} />
        <Button block disabled={!complete} loading={mutation.isPending} size="lg" type="submit" variant="primary">
          {t.company.create}
        </Button>
      </form>
    </AuthCard>
  )
}

export function OnboardingPage() {
  const navigate = useNavigate()
  const options = [
    { id: 'url', icon: Globe, label: t.onboarding.url, desc: t.onboarding.urlDesc, hint: t.onboarding.urlHint, to: '/onboarding/url' },
    { id: 'files', icon: FileUp, label: t.onboarding.files, desc: t.onboarding.filesDesc, hint: t.onboarding.filesHint, to: '/onboarding/files' },
    { id: 'chat', icon: MessageSquareText, label: t.onboarding.chat, desc: t.onboarding.chatDesc, hint: t.onboarding.chatHint, to: '/onboarding/chat' },
  ]
  return (
    <AuthCard
      description={t.onboarding.intro}
      footer={
        <Button onClick={() => navigate('/assistant')} variant="ghost">
          {t.onboarding.skip}
        </Button>
      }
      steps={{ labels: STEPS, current: 1 }}
      title={t.onboarding.title}
      wide
    >
      <div className="ui-list">
        {options.map((option) => (
          <ListRow
            icon={option.icon}
            key={option.id}
            onClick={() => navigate(option.to)}
            subtitle={option.desc}
            title={option.label}
            trailing={<Tag tone={option.id === 'url' ? 'accent' : 'neutral'}>{option.hint}</Tag>}
          />
        ))}
      </div>
    </AuthCard>
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
    <AuthCard back={<BackLink to="/onboarding" />} description={t.onboarding.urlDesc} steps={{ labels: STEPS, current: 1 }} title={t.onboarding.urlTitle}>
      <form
        className="ui-form-stack"
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <TextField inputMode="url" label={t.onboarding.urlLabel} maxLength={2048} onChange={setUrl} placeholder={t.onboarding.urlPlaceholder} value={url} />
        <Button block disabled={!url.trim()} loading={start.isPending} size="lg" type="submit" variant="primary">
          {t.onboarding.start}
        </Button>
      </form>
    </AuthCard>
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
    <AuthCard back={<BackLink to="/onboarding" />} description={t.onboarding.chatDesc} steps={{ labels: STEPS, current: 1 }} title={t.onboarding.chatTitle} wide>
      <TextArea label={t.onboarding.chatLabel} maxLength={10000} onChange={setText} placeholder={t.onboarding.chatPlaceholder} rows={8} showCount value={text} />
      <Button block disabled={!text.trim()} loading={start.isPending} onClick={submit} size="lg" variant="primary">
        {t.onboarding.start}
      </Button>
    </AuthCard>
  )
}

/** 隐藏的原生文件选择框 + 按钮触发。上传前在前端检查大小，真实类型由后端按文件头校验。 */
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

  const element = <input accept={ACCEPTED_FILES} hidden multiple onChange={(event) => void upload(event.target.files)} ref={input} type="file" />
  return { element, open: () => input.current?.click(), uploading }
}

export function OnboardingFilesPage() {
  const [uploaded, setUploaded] = useState<Asset[]>([])
  const start = useStartExtraction()
  const picker = useFilePicker('catalog', (asset) => setUploaded((prev) => [...prev, asset]))
  const ready = uploaded.length > 0 && !picker.uploading
  return (
    <AuthCard back={<BackLink to="/onboarding" />} description={t.onboarding.filesDesc} steps={{ labels: STEPS, current: 1 }} title={t.onboarding.filesTitle} wide>
      {picker.element}
      <button className="dropzone" disabled={picker.uploading} onClick={picker.open} type="button">
        <Upload aria-hidden size={22} />
        <span>{picker.uploading ? t.onboarding.uploading : t.onboarding.chooseFiles}</span>
        <small>{t.onboarding.filesHint}</small>
      </button>
      <ListGroup title={uploaded.length ? t.onboarding.uploaded(uploaded.length) : t.onboarding.noFiles}>
        {uploaded.length ? (
          uploaded.map((asset) => <ListRow key={asset.id} title={asset.display_name} value={t.assets.size(asset.size)} />)
        ) : (
          <ListRow subtitle={t.onboarding.filesDesc} title={t.onboarding.noFiles} />
        )}
      </ListGroup>
      <Button
        block
        disabled={!ready}
        loading={start.isPending}
        onClick={() => start.mutate({ source: 'file', asset_ids: uploaded.map((asset) => asset.id) })}
        size="lg"
        variant="primary"
      >
        {t.onboarding.start}
      </Button>
    </AuthCard>
  )
}
