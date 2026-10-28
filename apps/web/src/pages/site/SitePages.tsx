// 官网二级页面：分区编辑（含 AI 改写、需确认标记）、预览、模板、域名、版本、询盘、健康检查。
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Check, CheckCircle2, Inbox, Mail, Monitor, RefreshCw, ShieldAlert, Smartphone, Wand2 } from 'lucide-react'
import { useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { QueryView } from '@/components/QueryView'
import { useErrorToast } from '@/feedback/useErrorToast'
import { t } from '@/i18n'
import { AppPage } from '@/layout/AppPage'
import { useSession } from '@/session/session'
import { siteApi, type SiteContent, type SiteFlag, type SiteSection, type TemplateKey } from '@/site/api'
import { AI_SECTIONS, EDITABLE, flagsFor, READ_ONLY_SECTIONS, SECTION_ORDER, sectionData, sectionDraft, sectionSummary } from '@/site/model'
import { BulletList, Button, Card, CardHeader, ConfirmDialog, cx, FormModal, Heading, KeyValue, ListGroup, ListRow, NumberList, Quote, Stat, Tabs, Tag, Text, TextArea, TextField, useToast } from '@/ui'
import { useDraft, useSite } from '../SitePage'

function useInvalidateSite() {
  const queryClient = useQueryClient()
  return () => {
    void queryClient.invalidateQueries({ queryKey: ['site'] })
    void queryClient.invalidateQueries({ queryKey: ['site-draft'] })
    void queryClient.invalidateQueries({ queryKey: ['site-versions'] })
  }
}

// ── 分区编辑 ───────────────────────────────────────────────────────────

export function SiteSectionPage() {
  const { section = '' } = useParams()
  const site = useSite()
  const draft = useDraft(site.data)
  if (!SECTION_ORDER.includes(section as SiteSection)) return <Navigate replace to="/site" />
  return (
    <AppPage back="/site" title={t.site.sections[section as SiteSection]} width="narrow">
      <QueryView query={draft}>
        {(version) => <SectionEditor content={version.content} flags={version.flags} key={version.id} section={section as SiteSection} />}
      </QueryView>
    </AppPage>
  )
}

function SectionEditor({ section, content, flags }: { section: SiteSection; content: SiteContent; flags: SiteFlag[] }) {
  const navigate = useNavigate()
  const toast = useToast()
  const showError = useErrorToast()
  const invalidate = useInvalidateSite()
  const fields = EDITABLE[section]
  const initial = sectionDraft(content, section)
  const [draft, setDraft] = useState(initial)
  const [rewriteOpen, setRewriteOpen] = useState(false)
  const [instruction, setInstruction] = useState('')
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial)
  const pending = flagsFor(flags, section)

  const save = useMutation({
    mutationFn: () => siteApi.saveSection(section, sectionData(content, section, draft)),
    onSuccess: () => {
      invalidate()
      toast.show(t.common.saved)
      navigate('/site', { replace: true })
    },
    onError: showError,
  })
  const rewrite = useMutation({
    mutationFn: () => siteApi.rewrite(section, instruction.trim()),
    onSuccess: () => {
      invalidate()
      toast.show(t.site.aiRewriteStarted)
      navigate('/site', { replace: true })
    },
    onError: showError,
  })
  const ack = useMutation({ mutationFn: siteApi.ackFlag, onSuccess: invalidate, onError: showError })

  const readOnly = READ_ONLY_SECTIONS.includes(section)
  return (
    <div className="stack-lg">
      {pending.length ? (
        <Card className="flag-card">
          <CardHeader description={t.site.flagsDesc} icon={AlertTriangle} title={t.site.needsReview} />
          <div className="ui-list">
            {pending.map((flag) => (
              <ListRow
                key={`${flag.field}-${flag.text}`}
                subtitle={flag.reason}
                title={flag.text}
                trailing={
                  <Button icon={Check} onClick={() => ack.mutate(flag)} size="sm" variant="outline">
                    {t.site.confirmTrue}
                  </Button>
                }
              />
            ))}
          </div>
        </Card>
      ) : null}
      <Card padding="lg">
        {fields ? (
          <div className="ui-form-stack">
            {fields.map((field) => {
              const label = t.site.fields[field.key as keyof typeof t.site.fields] ?? field.key
              const common = {
                label,
                maxLength: field.max,
                onChange: (value: string) => setDraft((prev) => ({ ...prev, [field.key]: value })),
                placeholder: label,
                value: draft[field.key] ?? '',
              }
              return field.kind === 'text' ? <TextField key={field.key} {...common} /> : <TextArea key={field.key} rows={field.kind === 'long' ? 6 : 4} {...common} />
            })}
          </div>
        ) : (
          <div className="stack">
            <Text>{sectionSummary(content, section) || '—'}</Text>
            {readOnly ? <Quote tone="accent">{t.site.sectionFromProfile}</Quote> : null}
          </div>
        )}
      </Card>
      {fields || AI_SECTIONS.includes(section) ? (
        <div className="ui-form-actions">
          {AI_SECTIONS.includes(section) ? (
            <Button icon={Wand2} onClick={() => setRewriteOpen(true)} variant="outline">
              {t.site.aiRewrite}
            </Button>
          ) : null}
          {fields ? (
            <Button disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()} variant="primary">
              {t.common.save}
            </Button>
          ) : null}
        </div>
      ) : null}
      <FormModal
        loading={rewrite.isPending}
        onClose={() => setRewriteOpen(false)}
        onPrimary={() => {
          if (instruction.trim().length < 2) return
          setRewriteOpen(false)
          rewrite.mutate()
        }}
        open={rewriteOpen}
        primaryDisabled={instruction.trim().length < 2}
        primaryLabel={t.common.confirm}
        secondaryLabel={t.common.cancel}
        title={t.site.aiRewrite}
      >
        <TextArea maxLength={500} onChange={setInstruction} placeholder={t.site.aiRewritePlaceholder} value={instruction} />
      </FormModal>
    </div>
  )
}

// ── 预览 ───────────────────────────────────────────────────────────────

export function SitePreviewPage() {
  const [mode, setMode] = useState<'desktop' | 'mobile'>('desktop')
  const preview = useQuery({ queryKey: ['site-preview'], queryFn: siteApi.previewUrl, staleTime: 10 * 60_000 })
  return (
    <AppPage
      back="/site"
      title={t.site.preview}
      toolbar={
        <Tabs
          items={[
            { value: 'desktop', label: <span className="row"><Monitor aria-hidden size={14} />{t.site.previewDesktop}</span> },
            { value: 'mobile', label: <span className="row"><Smartphone aria-hidden size={14} />{t.site.previewMobile}</span> },
          ]}
          label={t.site.preview}
          onChange={setMode}
          value={mode}
        />
      }
      width="full"
    >
      <QueryView query={preview}>
        {(data) => (
          <div className={cx('site-preview', `is-${mode}`)} data-mode={mode}>
            <div className="site-preview__frame">
              {/* 沙箱：不允许脚本、表单提交与顶层跳转；预览接口本身也返回 CSP sandbox */}
              <iframe referrerPolicy="no-referrer" sandbox="" src={data.url} title={t.site.preview} />
            </div>
          </div>
        )}
      </QueryView>
    </AppPage>
  )
}

// ── 模板 ───────────────────────────────────────────────────────────────

export function SiteTemplatePage() {
  const site = useSite()
  const toast = useToast()
  const showError = useErrorToast()
  const invalidate = useInvalidateSite()
  const save = useMutation({
    mutationFn: (key: TemplateKey) => siteApi.setTemplate(key),
    onSuccess: () => {
      invalidate()
      toast.show(t.site.templateSaved)
    },
    onError: showError,
  })
  return (
    <AppPage back="/site" title={t.site.template}>
      <div className="grid-3 template-grid">
        {(['industrial', 'building', 'consumer'] as TemplateKey[]).map((key) => {
          const current = site.data?.template_key === key
          return (
            <button
              aria-pressed={current}
              className={cx('template-card', current && 'is-current')}
              disabled={save.isPending}
              key={key}
              onClick={() => !current && save.mutate(key)}
              type="button"
            >
              <span aria-hidden className={`template-card__thumb template-card__thumb--${key}`}>
                <span />
                <span />
                <span />
              </span>
              <span className="template-card__name">
                {t.site.templates[key]}
                {current ? <Tag tone="accent">{t.assistant.current}</Tag> : null}
              </span>
            </button>
          )
        })}
      </div>
    </AppPage>
  )
}

// ── 域名 ───────────────────────────────────────────────────────────────

const DOMAIN_RE = /^(?!-)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i

export function SiteDomainPage() {
  const site = useSite()
  const toast = useToast()
  const showError = useErrorToast()
  const invalidate = useInvalidateSite()
  const [domain, setDomain] = useState('')
  const save = useMutation({ mutationFn: siteApi.setDomain, onSuccess: invalidate, onError: showError })
  const verify = useMutation({
    mutationFn: siteApi.verifyDomain,
    onSuccess: () => {
      invalidate()
      toast.show(t.site.domainVerified)
    },
    onError: showError,
  })
  const remove = useMutation({ mutationFn: siteApi.removeDomain, onSuccess: invalidate, onError: showError })
  const submitDomain = () => {
    if (!domain.trim()) return
    const value = domain.trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0]
    if (!DOMAIN_RE.test(value)) return toast.show(t.site.domainInvalid)
    save.mutate(value)
    setDomain('')
  }
  return (
    <AppPage back="/site" title={t.site.domainTitle} width="narrow">
      <QueryView query={site}>
        {(data) =>
          data ? (
            <div className="stack-lg">
              <Card>
                <KeyValue items={[{ label: t.site.subdomain, value: <span className="mono">{data.subdomain_host}</span> }]} />
              </Card>
              <Card>
                <CardHeader title={t.site.domainStep1} />
                <div className="row domain-row">
                  <TextField fieldClassName="grow" maxLength={253} onChange={setDomain} onSubmit={submitDomain} placeholder={data.custom_domain ?? t.site.domainPlaceholder} value={domain} />
                  <Button disabled={!domain.trim()} loading={save.isPending} onClick={submitDomain} variant="secondary">
                    {t.site.domainSave}
                  </Button>
                </div>
              </Card>
              {data.custom_domain ? (
                <>
                  <Card>
                    <CardHeader title={t.site.domainStep2} />
                    <NumberList items={[t.site.domainCname(data.subdomain_host), t.site.domainTxt(data.custom_domain, data.domain_token)]} />
                  </Card>
                  <Card>
                    <CardHeader
                      actions={<Tag tone={data.domain_verified ? 'success' : 'warning'}>{data.domain_verified ? t.site.statusPublished : t.site.statusDraft}</Tag>}
                      description={data.custom_domain}
                      title={t.site.domainStep3}
                    />
                    <div className="ui-form-actions ui-form-actions--start">
                      {!data.domain_verified ? (
                        <Button loading={verify.isPending} onClick={() => verify.mutate()} variant="primary">
                          {verify.isPending ? t.site.domainVerifying : t.site.domainVerify}
                        </Button>
                      ) : null}
                      <Button onClick={() => remove.mutate()} variant="danger-ghost">
                        {t.site.domainRemove}
                      </Button>
                    </div>
                  </Card>
                </>
              ) : null}
            </div>
          ) : (
            <Navigate replace to="/site" />
          )
        }
      </QueryView>
    </AppPage>
  )
}

// ── 版本 ───────────────────────────────────────────────────────────────

export function SiteVersionsPage() {
  const versions = useQuery({ queryKey: ['site-versions'], queryFn: siteApi.versions })
  const toast = useToast()
  const showError = useErrorToast()
  const invalidate = useInvalidateSite()
  const [target, setTarget] = useState<string | null>(null)
  const restore = useMutation({
    mutationFn: siteApi.restore,
    onSuccess: () => {
      invalidate()
      toast.show(t.site.restored)
    },
    onError: showError,
  })
  return (
    <AppPage back="/site" title={t.site.versionsTitle} width="narrow">
      <QueryView query={versions}>
        {(items) => (
          <div className="ui-list">
            {items.map((v) => (
              <ListRow
                key={v.id}
                subtitle={v.created_at.slice(0, 16).replace('T', ' ')}
                title={v.note || '—'}
                trailing={
                  v.is_draft ? (
                    <Tag tone="accent">{t.site.versionCurrent}</Tag>
                  ) : (
                    <>
                      {v.is_published ? <Tag tone="success">{t.site.versionPublished}</Tag> : null}
                      <Button icon={RefreshCw} onClick={() => setTarget(v.id)} size="sm" variant="ghost">
                        {t.site.restore}
                      </Button>
                    </>
                  )
                }
              />
            ))}
          </div>
        )}
      </QueryView>
      <ConfirmDialog
        body={t.site.restoreDesc}
        cancelLabel={t.common.cancel}
        confirmLabel={t.site.restore}
        onCancel={() => setTarget(null)}
        onConfirm={() => {
          if (target) restore.mutate(target)
          setTarget(null)
        }}
        open={target !== null}
        title={t.site.restoreConfirm}
      />
    </AppPage>
  )
}

// ── 询盘 ───────────────────────────────────────────────────────────────

export function SiteInquiriesPage() {
  const navigate = useNavigate()
  const session = useSession()
  const list = useQuery({ queryKey: ['site-inquiries', session.company?.id, 'all'], queryFn: () => siteApi.inquiries(100) })
  return (
    <AppPage back="/site" title={t.site.inquiriesTitle}>
      <QueryView empty={{ title: t.site.noInquiries, desc: t.site.generateDesc, icon: Inbox }} isEmpty={(items) => items.length === 0} query={list}>
        {(items) => (
          <div className="ui-list">
            {items.map((item) => (
              <ListRow
                dot={item.status === 'new'}
                key={item.id}
                meta={item.created_at.slice(0, 10)}
                onClick={() => navigate(`/site/inquiries/${item.id}`)}
                subtitle={item.product_ref || item.message}
                title={t.site.inquiryFrom(item.company_name || item.name, item.country)}
              />
            ))}
          </div>
        )}
      </QueryView>
    </AppPage>
  )
}

export function SiteInquiryPage() {
  const { id = '' } = useParams()
  const toast = useToast()
  const showError = useErrorToast()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const inquiry = useQuery({ queryKey: ['site-inquiry', id], queryFn: () => siteApi.inquiry(id) })
  const mark = useMutation({
    mutationFn: () => siteApi.markInquiry(id, 'spam'),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['site-inquiries'] })
      toast.show(t.site.marked)
      navigate('/site/inquiries', { replace: true })
    },
    onError: showError,
  })
  return (
    <AppPage back="/site/inquiries" title={t.site.inquiryTitle} width="narrow">
      <QueryView query={inquiry}>
        {(item) => (
          <Card padding="lg">
            <div className="stack">
              <Heading level={3}>{t.site.inquiryFrom(item.company_name || item.name, item.country)}</Heading>
              <BulletList items={[item.name, item.email, item.product_ref, item.created_at.slice(0, 16).replace('T', ' ')].filter(Boolean)} />
              {/* 询盘内容来自公网，按纯文本显示 */}
              <Quote>
                <span className="pre-wrap">{item.message}</span>
              </Quote>
              <div className="ui-form-actions ui-form-actions--start">
                <Button icon={Mail} onClick={() => window.open(`mailto:${encodeURIComponent(item.email)}`, '_self')} variant="primary">
                  {t.site.replyByEmail}
                </Button>
                {item.status !== 'spam' ? (
                  <Button icon={ShieldAlert} loading={mark.isPending} onClick={() => mark.mutate()} variant="ghost">
                    {t.site.markSpam}
                  </Button>
                ) : null}
              </div>
            </div>
          </Card>
        )}
      </QueryView>
    </AppPage>
  )
}

// ── 健康检查 ───────────────────────────────────────────────────────────

export function SiteHealthPage() {
  const navigate = useNavigate()
  const showError = useErrorToast()
  const queryClient = useQueryClient()
  const health = useQuery({ queryKey: ['site-health'], queryFn: siteApi.health, retry: false })
  const run = useMutation({
    mutationFn: siteApi.healthCheck,
    onSuccess: (data) => {
      queryClient.setQueryData(['site-health'], data)
      void queryClient.invalidateQueries({ queryKey: ['site'] })
    },
    onError: showError,
  })
  const data = run.data ?? health.data
  return (
    <AppPage
      actions={
        <Button icon={RefreshCw} loading={run.isPending} onClick={() => run.mutate()} variant="primary">
          {t.site.healthRun}
        </Button>
      }
      back="/site"
      title={t.site.healthTitle}
      width="narrow"
    >
      {data ? (
        <div className="stack-lg">
          <Stat icon={CheckCircle2} label={t.site.healthTitle} tone={data.score >= 80 ? 'success' : 'warning'} value={t.site.health(data.score)} />
          {data.issues.length ? (
            <ListGroup title={t.site.healthIssues}>
              {data.issues.map((issue) => (
                <ListRow
                  className="site-issue"
                  key={issue.key}
                  onClick={() => {
                    if (issue.section === 'domain') navigate('/site/domain')
                    else if (['certificates', 'contact', 'markets'].includes(issue.section)) navigate('/me/profile')
                    else if (issue.section === 'factory' || issue.section === 'products') navigate('/me/products')
                    else navigate(`/site/sections/${issue.section}`)
                  }}
                  subtitle={issue.fix}
                  title={issue.title}
                  trailing={issue.severity === 'high' ? <Tag tone="danger">{t.site.severityHigh}</Tag> : undefined}
                />
              ))}
            </ListGroup>
          ) : null}
        </div>
      ) : null}
    </AppPage>
  )
}
