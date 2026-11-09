// 开通向导：第 1 步工厂名 → 第 2 步按类别上传资料 → 第 3 步选网站风格。每一步都标明「第 X 步，共 3 步」。
// 已有企业的老板再次进入时从第 2 步开始（补传资料 / 改风格）。
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ApiError } from '@/api/client'
import { api } from '@/api/endpoints'
import { useErrorToast } from '@/feedback/useErrorToast'
import { cust } from '@/i18n/customer'
import { useSession } from '@/session/session'
import { serviceApi, type StyleChoice } from '@/service/api'
import { MaterialChecklist, MaterialList, StylePicker, useAssets, useOverview } from '@/service/components'
import { Button, Centered, Spinner, TextArea, TextField, useToast } from '@/ui'

const TOTAL = 3

function StepHead({ step, title, desc }: { step: number; title: string; desc: string }) {
  return (
    <header className="wizard__head">
      <p className="wizard__step">{cust.start.stepOf(step, TOTAL)}</p>
      <div aria-hidden className="wizard__bar">
        {Array.from({ length: TOTAL }, (_, i) => (
          <span className={i < step ? 'is-on' : ''} key={i} />
        ))}
      </div>
      <h1>{title}</h1>
      <p className="wizard__desc">{desc}</p>
    </header>
  )
}

export function StartPage() {
  const session = useSession()
  const [step, setStep] = useState(session.company ? 2 : 1)
  useEffect(() => {
    document.title = `${cust.start.nameTitle} · AI-CMO`
  }, [])
  // 第 1 步创建企业后，session 刷新完成再进入第 2 步
  useEffect(() => {
    if (step === 1 && session.company) setStep(2)
  }, [session.company, step])

  return (
    <div className="wizard">
      {step === 1 ? <NameStep /> : step === 2 ? <MaterialsStep onNext={() => setStep(3)} /> : <StyleStep onBack={() => setStep(2)} />}
    </div>
  )
}

function NameStep() {
  const session = useSession()
  const showError = useErrorToast()
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const create = useMutation({
    mutationFn: () => api.createCompany({ name_cn: name.trim(), name_en: '' }),
    onSuccess: async (company) => {
      await session.refresh()
      session.selectCompany(company.id)
    },
    onError: showError,
  })
  function submit() {
    if (name.trim().length < 2) return setError(cust.start.nameTooShort)
    setError('')
    create.mutate()
  }
  return (
    <form
      className="wizard__body"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      <StepHead desc={cust.start.nameDesc} step={1} title={cust.start.nameTitle} />
      <TextField error={error || undefined} label={cust.start.nameLabel} maxLength={100} onChange={setName} placeholder={cust.start.namePlaceholder} value={name} />
      <div className="wizard__actions">
        <Button disabled={!name.trim()} loading={create.isPending} size="lg" type="submit" variant="primary">
          {cust.start.next}
        </Button>
      </div>
    </form>
  )
}

function MaterialsStep({ onNext }: { onNext: () => void }) {
  const overview = useOverview()
  const assets = useAssets()
  if (!overview.data || !assets.data) {
    return (
      <Centered>
        <Spinner />
      </Centered>
    )
  }
  const missing = overview.data.missing.length > 0
  return (
    <div className="wizard__body wizard__body--wide">
      <StepHead desc={cust.start.materialsDesc} step={2} title={cust.start.materialsTitle} />
      <MaterialChecklist categories={overview.data.categories} counts={overview.data.materials} />
      <MaterialList assets={assets.data} categories={overview.data.categories} />
      <div className="wizard__actions wizard__actions--sticky">
        {missing ? (
          <Button onClick={onNext} variant="ghost">
            {cust.start.skipForNow}
          </Button>
        ) : null}
        <Button onClick={onNext} size="lg" variant="primary">
          {cust.start.next}
        </Button>
      </div>
    </div>
  )
}

function StyleStep({ onBack }: { onBack: () => void }) {
  const navigate = useNavigate()
  const toast = useToast()
  const showError = useErrorToast()
  const queryClient = useQueryClient()
  const overview = useOverview()
  const [choice, setChoice] = useState<StyleChoice | ''>('')
  const [link, setLink] = useState('')
  const [note, setNote] = useState('')
  const [linkError, setLinkError] = useState('')
  useEffect(() => {
    if (overview.data?.style_choice && !choice) setChoice(overview.data.style_choice)
  }, [overview.data?.style_choice, choice])

  const submit = useMutation({
    mutationFn: () => serviceApi.submitOnboarding({ style_choice: choice as StyleChoice, links: link.trim() ? [link.trim()] : [], note: note.trim() }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['service-overview'] })
      toast.show(cust.start.submitted)
      navigate('/home', { replace: true })
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 422) setLinkError(cust.start.linkInvalid)
      else showError(error)
    },
  })

  return (
    <div className="wizard__body wizard__body--wide">
      <StepHead desc={cust.start.styleDesc} step={3} title={cust.start.styleTitle} />
      <StylePicker onChange={setChoice} value={choice} />
      <div className="wizard__extra">
        <TextField error={linkError || undefined} inputMode="url" label={cust.start.linksLabel} maxLength={300} onChange={(v) => (setLink(v), setLinkError(''))} placeholder={cust.start.linksPlaceholder} value={link} />
        <TextArea label={cust.start.noteLabel} maxLength={1000} onChange={setNote} placeholder={cust.start.notePlaceholder} rows={3} value={note} />
      </div>
      <div className="wizard__actions">
        <Button icon={ArrowLeft} onClick={onBack} variant="ghost">
          {cust.start.prev}
        </Button>
        <Button disabled={!choice} loading={submit.isPending} onClick={() => submit.mutate()} size="lg" variant="primary">
          {cust.start.submit}
        </Button>
      </div>
    </div>
  )
}
