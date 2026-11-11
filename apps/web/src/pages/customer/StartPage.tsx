// 开通向导，三步：
//   第 1 步：工厂名 + 做什么产品 + 想卖到哪里 → 提交后马上开始找买家（不需要网站、不需要照片）
//   第 2 步：传照片（全部可选，用来做英文网站）
//   第 3 步：选网站风格（可选）
// 已有企业的老板再次进入时：已经填过产品就从第 2 步开始。
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Check } from 'lucide-react'
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
  const overview = useOverview()
  const [step, setStep] = useState<number | null>(session.company ? null : 1)
  useEffect(() => {
    document.title = `${cust.start.nameTitle} · AI-CMO`
  }, [])
  // 已有企业：填过产品的从第 2 步开始，否则从第 1 步（补填产品）
  useEffect(() => {
    if (step === null && overview.data) setStep(overview.data.buyers.business ? 2 : 1)
  }, [step, overview.data])

  if (step === null) {
    return (
      <Centered>
        <Spinner />
      </Centered>
    )
  }
  return (
    <div className="wizard">
      {step === 1 ? <BusinessStep onDone={() => setStep(2)} /> : step === 2 ? <MaterialsStep onNext={() => setStep(3)} /> : <StyleStep onBack={() => setStep(2)} />}
    </div>
  )
}

function BusinessStep({ onDone }: { onDone: () => void }) {
  const session = useSession()
  const toast = useToast()
  const showError = useErrorToast()
  const queryClient = useQueryClient()
  const overview = useOverview()
  const [name, setName] = useState(session.company?.name_cn ?? '')
  const [business, setBusiness] = useState('')
  const [markets, setMarkets] = useState('')
  const [errors, setErrors] = useState<{ name?: string; business?: string }>({})
  useEffect(() => {
    if (overview.data?.buyers.business && !business) setBusiness(overview.data.buyers.business)
    if (overview.data?.buyers.target_markets && !markets) setMarkets(overview.data.buyers.target_markets)
    // 只在首次拿到数据时回填
  }, [overview.data?.buyers.business]) // eslint-disable-line

  const submit = useMutation({
    mutationFn: async () => {
      if (!session.company) {
        const company = await api.createCompany({ name_cn: name.trim(), name_en: '' })
        await session.refresh()
        session.selectCompany(company.id)
      }
      return serviceApi.submitBusiness({ business: business.trim(), target_markets: markets.trim() })
    },
    onSuccess: async (data) => {
      queryClient.setQueryData(['service-overview', session.company?.id], data)
      await queryClient.invalidateQueries({ queryKey: ['service-overview'] })
      toast.show(cust.start.buyersStarted)
      onDone()
    },
    onError: showError,
  })

  function go() {
    const next: typeof errors = {}
    if (!session.company && name.trim().length < 2) next.name = cust.start.nameTooShort
    if (business.trim().length < 2) next.business = cust.start.businessTooShort
    setErrors(next)
    if (!next.name && !next.business) submit.mutate()
  }

  return (
    <form
      className="wizard__body"
      onSubmit={(e) => {
        e.preventDefault()
        go()
      }}
    >
      <StepHead desc={cust.start.nameDesc} step={1} title={cust.start.nameTitle} />
      {session.company ? (
        <p className="wizard__company">{session.company.name_cn}</p>
      ) : (
        <TextField error={errors.name} label={cust.start.nameLabel} maxLength={100} onChange={setName} placeholder={cust.start.namePlaceholder} value={name} />
      )}
      <TextArea error={errors.business} hint={cust.start.businessHint} label={cust.start.businessLabel} maxLength={1000} onChange={setBusiness} placeholder={cust.start.businessPlaceholder} rows={3} value={business} />
      <TextField label={cust.start.marketsLabel} maxLength={300} onChange={setMarkets} placeholder={cust.start.marketsPlaceholder} value={markets} />
      <div className="wizard__actions">
        <Button icon={Check} loading={submit.isPending} size="lg" type="submit" variant="primary">
          {cust.start.startBuyers}
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
  const any = assets.data.length > 0
  return (
    <div className="wizard__body wizard__body--wide">
      <StepHead desc={cust.start.materialsDesc} step={2} title={cust.start.materialsTitle} />
      <MaterialChecklist categories={overview.data.categories} counts={overview.data.materials} />
      <MaterialList assets={assets.data} categories={overview.data.categories} />
      <div className="wizard__actions wizard__actions--sticky">
        {any ? null : (
          <Button onClick={onNext} variant="ghost">
            {cust.start.skipForNow}
          </Button>
        )}
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
    mutationFn: () => serviceApi.submitOnboarding({ style_choice: (choice || 'own') as StyleChoice, links: link.trim() ? [link.trim()] : [], note: note.trim() }),
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
        <Button loading={submit.isPending} onClick={() => submit.mutate()} size="lg" variant="primary">
          {cust.start.submit}
        </Button>
      </div>
    </div>
  )
}
