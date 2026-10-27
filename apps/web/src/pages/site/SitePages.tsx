// 官网二级页面：分区编辑（含 AI 改写、需确认标记）、预览、模板、域名、版本、询盘、健康检查。
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, FormDoubleLine, FormSingleLine, ListSectionTitle, Markdown, SettingsFullWidthItem, Tab, Tag } from '@yb/generated/components'
import { useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { QueryView } from '@/components/local/QueryView'
import { StackPage } from '@/components/local/StackPage'
import { ConfirmDialog, FormSheet } from '@/feedback/overlays'
import { useToast } from '@/feedback/toast'
import { useErrorToast } from '@/feedback/useErrorToast'
import { t } from '@/i18n'
import { useSession } from '@/session/session'
import { siteApi, type SiteContent, type SiteFlag, type SiteSection, type TemplateKey } from '@/site/api'
import { AI_SECTIONS, EDITABLE, flagsFor, READ_ONLY_SECTIONS, SECTION_ORDER, sectionData, sectionDraft, sectionSummary } from '@/site/model'
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
    <QueryView query={draft}>
      {(version) => <SectionEditor content={version.content} flags={version.flags} key={version.id} section={section as SiteSection} />}
    </QueryView>
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
    <StackPage
      backTo="/site"
      footer={
        <div className="form-actions">
          {fields ? (
            <Button onAction={(a) => a === 'press' && dirty && !save.isPending && save.mutate()} size="L" state={dirty && !save.isPending ? 'Default' : 'Disable'} type="Primary">
              {t.common.save}
            </Button>
          ) : null}
          {AI_SECTIONS.includes(section) ? (
            <Button onAction={(a) => a === 'press' && setRewriteOpen(true)} size="L" type="Secondary">
              {t.site.aiRewrite}
            </Button>
          ) : null}
        </div>
      }
      surface="primary"
      title={t.site.sections[section]}
    >
      {pending.length ? (
        <section>
          <ListSectionTitle>{t.site.needsReview}</ListSectionTitle>
          {pending.map((flag) => (
            <div className="site-flag-row" key={`${flag.field}-${flag.text}`}>
              <SettingsFullWidthItem subtitle={flag.reason} trailing=" " trailingKind="none" type="双行列表-常规">
                {flag.text}
              </SettingsFullWidthItem>
              <span className="site-flag-action">
                <Button onAction={(a) => a === 'press' && ack.mutate(flag)} size="S" type="Outline">
                  {t.site.confirmTrue}
                </Button>
              </span>
            </div>
          ))}
        </section>
      ) : null}
      {fields ? (
        <div className="form-stack">
          {fields.map((field) => {
            const label = t.site.fields[field.key as keyof typeof t.site.fields] ?? field.key
            const props = {
              label,
              maxLength: field.max,
              onChange: (value: string) => setDraft((prev) => ({ ...prev, [field.key]: value })),
              placeholder: label,
              value: draft[field.key] ?? '',
            }
            return field.kind === 'text' ? <FormSingleLine align="left" key={field.key} {...props} /> : <FormDoubleLine key={field.key} {...props} />
          })}
        </div>
      ) : (
        <div className="content-inset">
          <Markdown variant="Body">
            <p>{sectionSummary(content, section) || '—'}</p>
          </Markdown>
          {readOnly ? (
            <Markdown variant="Quote" quoteText={<p>{t.site.sectionFromProfile}</p>} />
          ) : null}
        </div>
      )}
      <FormSheet
        onClose={() => setRewriteOpen(false)}
        onPrimary={() => {
          if (instruction.trim().length < 2 || rewrite.isPending) return
          setRewriteOpen(false)
          rewrite.mutate()
        }}
        open={rewriteOpen}
        primaryLabel={t.common.confirm}
        secondaryLabel={t.common.cancel}
        title={t.site.aiRewrite}
      >
        <div className="sheet-form">
          <FormDoubleLine maxLength={500} onChange={setInstruction} placeholder={t.site.aiRewritePlaceholder} value={instruction} />
        </div>
      </FormSheet>
    </StackPage>
  )
}

// ── 预览 ───────────────────────────────────────────────────────────────

export function SitePreviewPage() {
  const [mode, setMode] = useState<'desktop' | 'mobile'>('mobile')
  const preview = useQuery({ queryKey: ['site-preview'], queryFn: siteApi.previewUrl, staleTime: 10 * 60_000 })
  return (
    <StackPage backTo="/site" surface="primary" title={t.site.preview}>
      <div className="site-preview-tabs">
        <Tab
          items={[t.site.previewMobile, t.site.previewDesktop]}
          onAction={(action) => {
            if (action === 'tab:0') setMode('mobile')
            if (action === 'tab:1') setMode('desktop')
          }}
        />
      </div>
      <QueryView query={preview}>
        {(data) => (
          <div className="site-preview" data-mode={mode}>
            {/* 沙箱：不允许脚本、表单提交与顶层跳转；预览接口本身也返回 CSP sandbox */}
            <iframe referrerPolicy="no-referrer" sandbox="" src={data.url} title={t.site.preview} />
          </div>
        )}
      </QueryView>
    </StackPage>
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
    <StackPage backTo="/site" title={t.site.template}>
      {(['industrial', 'building', 'consumer'] as TemplateKey[]).map((key) => (
        <SettingsFullWidthItem
          key={key}
          onAction={(a) => a === 'open' && site.data?.template_key !== key && save.mutate(key)}
          trailing={site.data?.template_key === key ? t.assistant.current : ' '}
          trailingKind="chevron"
          type="单行列表-常规"
        >
          {t.site.templates[key]}
        </SettingsFullWidthItem>
      ))}
    </StackPage>
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
  return (
    <StackPage backTo="/site" surface="primary" title={t.site.domainTitle}>
      <QueryView query={site}>
        {(data) =>
          data ? (
            <>
              <ListSectionTitle>{t.site.subdomain}</ListSectionTitle>
              <SettingsFullWidthItem trailing=" " trailingKind="none" type="单行列表-常规">
                {data.subdomain_host}
              </SettingsFullWidthItem>
              <ListSectionTitle>{t.site.domainStep1}</ListSectionTitle>
              <div className="form-stack">
                <FormSingleLine align="left" maxLength={253} onChange={setDomain} placeholder={data.custom_domain ?? t.site.domainPlaceholder} value={domain} />
                <Button
                  onAction={(a) => {
                    if (a !== 'press' || !domain.trim()) return
                    const value = domain.trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0]
                    if (!DOMAIN_RE.test(value)) return toast.show(t.site.domainInvalid)
                    save.mutate(value)
                    setDomain('')
                  }}
                  size="M"
                  state={domain.trim() && !save.isPending ? 'Default' : 'Disable'}
                  type="Secondary"
                >
                  {t.site.domainSave}
                </Button>
              </div>
              {data.custom_domain ? (
                <>
                  <ListSectionTitle>{t.site.domainStep2}</ListSectionTitle>
                  <div className="content-inset">
                    <Markdown items={[t.site.domainCname(data.subdomain_host), t.site.domainTxt(data.custom_domain, data.domain_token)]} variant="OL" />
                  </div>
                  <ListSectionTitle>{t.site.domainStep3}</ListSectionTitle>
                  <SettingsFullWidthItem trailing={data.domain_verified ? t.site.statusPublished : t.site.statusDraft} trailingKind="none" type="单行列表-常规">
                    {data.custom_domain}
                  </SettingsFullWidthItem>
                  <div className="form-actions content-inset">
                    {!data.domain_verified ? (
                      <Button onAction={(a) => a === 'press' && !verify.isPending && verify.mutate()} size="L" state={verify.isPending ? 'Disable' : 'Default'} type="Primary">
                        {verify.isPending ? t.site.domainVerifying : t.site.domainVerify}
                      </Button>
                    ) : null}
                    <Button onAction={(a) => a === 'press' && remove.mutate()} size="M" type="Text">
                      {t.site.domainRemove}
                    </Button>
                  </div>
                </>
              ) : null}
            </>
          ) : (
            <Navigate replace to="/site" />
          )
        }
      </QueryView>
    </StackPage>
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
    <StackPage backTo="/site" title={t.site.versionsTitle}>
      <QueryView query={versions}>
        {(items) => (
          <div className="list-block">
            {items.map((v) => (
              <SettingsFullWidthItem
                key={v.id}
                onAction={(a) => a === 'open' && !v.is_draft && setTarget(v.id)}
                subtitle={v.created_at.slice(0, 16).replace('T', ' ')}
                trailing={v.is_draft ? t.site.versionCurrent : v.is_published ? t.site.versionPublished : t.site.restore}
                trailingKind={v.is_draft ? 'none' : 'chevron'}
                type="双行列表-常规"
              >
                {v.note || '—'}
              </SettingsFullWidthItem>
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
    </StackPage>
  )
}

// ── 询盘 ───────────────────────────────────────────────────────────────

export function SiteInquiriesPage() {
  const navigate = useNavigate()
  const session = useSession()
  const list = useQuery({ queryKey: ['site-inquiries', session.company?.id, 'all'], queryFn: () => siteApi.inquiries(100) })
  return (
    <StackPage backTo="/site" title={t.site.inquiriesTitle}>
      <QueryView empty={{ title: t.site.noInquiries, desc: t.site.generateDesc }} isEmpty={(items) => items.length === 0} query={list}>
        {(items) => (
          <div className="list-block">
            {items.map((item) => (
              <SettingsFullWidthItem
                key={item.id}
                onAction={(a) => a === 'open' && navigate(`/site/inquiries/${item.id}`)}
                showDot={item.status === 'new'}
                subtitle={item.product_ref || item.message}
                subtitle2={item.created_at.slice(0, 10)}
                trailingKind="chevron"
                trailing=" "
                type="三行列表-常规"
              >
                {t.site.inquiryFrom(item.company_name || item.name, item.country)}
              </SettingsFullWidthItem>
            ))}
          </div>
        )}
      </QueryView>
    </StackPage>
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
    <StackPage backTo="/site/inquiries" surface="primary" title={t.site.inquiryTitle}>
      <QueryView query={inquiry}>
        {(item) => (
          <div className="content-inset">
            <Markdown variant="Others+H3">{t.site.inquiryFrom(item.company_name || item.name, item.country)}</Markdown>
            <Markdown items={[item.name, item.email, item.product_ref, item.created_at.slice(0, 16).replace('T', ' ')].filter(Boolean)} variant="UL" />
            {/* 询盘内容来自公网，按纯文本显示 */}
            <Markdown variant="Quote" quoteText={<p className="pre-wrap">{item.message}</p>} />
            <div className="form-actions">
              <Button onAction={(a) => a === 'press' && window.open(`mailto:${encodeURIComponent(item.email)}`, '_self')} size="L" type="Primary">
                {t.site.replyByEmail}
              </Button>
              {item.status !== 'spam' ? (
                <Button onAction={(a) => a === 'press' && mark.mutate()} size="M" type="Text">
                  {t.site.markSpam}
                </Button>
              ) : null}
            </div>
          </div>
        )}
      </QueryView>
    </StackPage>
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
    <StackPage
      backTo="/site"
      footer={
        <Button onAction={(a) => a === 'press' && !run.isPending && run.mutate()} size="L" state={run.isPending ? 'Disable' : 'Default'} type="Primary">
          {t.site.healthRun}
        </Button>
      }
      title={t.site.healthTitle}
    >
      {data ? (
        <>
          <ListSectionTitle>{t.site.health(data.score)}</ListSectionTitle>
          {data.issues.map((issue) => (
            <div className="site-issue" key={issue.key}>
              <SettingsFullWidthItem
                onAction={(a) => {
                  if (a !== 'open') return
                  if (issue.section === 'domain') navigate('/site/domain')
                  else if (['certificates', 'contact', 'markets'].includes(issue.section)) navigate('/me/profile')
                  else if (issue.section === 'factory' || issue.section === 'products') navigate('/me/products')
                  else navigate(`/site/sections/${issue.section}`)
                }}
                subtitle={issue.fix}
                trailing=" "
                trailingKind="chevron"
                type="双行列表-常规"
              >
                {issue.title}
              </SettingsFullWidthItem>
              {issue.severity === 'high' ? (
                <span className="site-flag-tag">
                  <Tag showIcon={false} type="Badge">
                    !
                  </Tag>
                </span>
              ) : null}
            </div>
          ))}
        </>
      ) : null}
    </StackPage>
  )
}
