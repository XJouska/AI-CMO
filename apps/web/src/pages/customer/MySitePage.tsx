// 我的网站：还没开始 / 制作中 / 待你确认（预览 + 确认上线 + 我要修改）/ 已上线（网址 + 询价）。
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Copy, ExternalLink, ImagePlus, Monitor, PencilLine, Smartphone } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, type Asset } from '@/api/endpoints'
import { useErrorToast } from '@/feedback/useErrorToast'
import { cust } from '@/i18n/customer'
import { AppPage } from '@/layout/AppPage'
import { useSession } from '@/session/session'
import { siteApi } from '@/site/api'
import { serviceApi } from '@/service/api'
import { AssetThumb, useAssets, useOverview } from '@/service/components'
import { Button, Card, Centered, ConfirmDialog, cx, EmptyState, FormModal, ListGroup, ListRow, Spinner, Tabs, TextArea, useToast } from '@/ui'

export function MySitePage() {
  const [publishing, setPublishing] = useState(false)
  const overview = useOverview({ poll: publishing })
  const data = overview.data
  const isLive = data?.stage === 'live'
  // 网站上线后停止轮询
  useEffect(() => {
    if (publishing && isLive) setPublishing(false)
  }, [publishing, isLive])
  return (
    <AppPage title={cust.site.title} width={data?.stage === 'review' ? 'default' : 'narrow'}>
      {!data ? (
        <Centered>
          <Spinner />
        </Centered>
      ) : data.stage === 'start' ? (
        <NotStarted />
      ) : data.stage === 'review' || publishing ? (
        publishing ? (
          <Card className="cust-next">
            <h2 className="cust-next__title">{cust.site.publishing}</h2>
            <p className="cust-next__body">{cust.site.publishingDesc}</p>
            <Spinner />
          </Card>
        ) : (
          <ReviewSite onApproved={() => setPublishing(true)} />
        )
      ) : data.stage === 'live' ? (
        <LiveSite url={data.site_url} />
      ) : (
        <Building hours={data.build_hours} />
      )}
    </AppPage>
  )
}

function NotStarted() {
  const navigate = useNavigate()
  return (
    <EmptyState actionLabel={cust.site.goStart} description={cust.site.notStartedDesc} onAction={() => navigate('/start')} title={cust.site.notStarted} />
  )
}

function Building({ hours }: { hours: number }) {
  const navigate = useNavigate()
  const overview = useOverview()
  const assets = useAssets()
  const revising = Boolean(overview.data?.revising)
  const missing = overview.data?.missing ?? []
  return (
    <div className="stack-lg">
      <Card className="cust-next">
        <h2 className="cust-next__title">{revising ? cust.site.changing : cust.site.notReady}</h2>
        {revising ? null : <p className="cust-next__body">{cust.site.notReadyDesc(hours)}</p>}
      </Card>
      {missing.length ? (
        <Card className="cust-tip">
          <h2 className="cust-section-title">{cust.site.addPhotos}</h2>
          <p className="muted">{cust.site.addPhotosDesc}</p>
          <Button icon={ImagePlus} onClick={() => navigate('/materials')} variant="secondary">
            {cust.site.addPhotosAction}
          </Button>
        </Card>
      ) : null}
      <ReceivedMaterials assets={assets.data ?? []} />
    </div>
  )
}

function ReceivedMaterials({ assets }: { assets: Asset[] }) {
  const navigate = useNavigate()
  const overview = useOverview()
  const categories = overview.data?.categories ?? []
  return (
    <Card>
      <div className="row-between">
        <h2 className="cust-section-title">{cust.site.received}</h2>
        <Button onClick={() => navigate('/materials')} size="sm" variant="ghost">
          {cust.nav.materials}
        </Button>
      </div>
      <ul className="received">
        {categories.map((c) => {
          const items = assets.filter((a) => a.kind === c.key)
          return (
            <li key={c.key}>
              <span className="received__label">{c.label}</span>
              <span className="received__count">{items.length ? cust.upload.uploaded(items.length) : cust.upload.none}</span>
            </li>
          )
        })}
      </ul>
    </Card>
  )
}

function ReviewSite({ onApproved }: { onApproved: () => void }) {
  const session = useSession()
  const toast = useToast()
  const showError = useErrorToast()
  const queryClient = useQueryClient()
  const [mode, setMode] = useState<'desktop' | 'mobile'>(() => (window.matchMedia?.('(max-width: 760px)').matches ? 'mobile' : 'desktop'))
  const [approving, setApproving] = useState(false)
  const [changing, setChanging] = useState(false)
  const preview = useQuery({ queryKey: ['site-preview', session.company?.id], queryFn: siteApi.previewUrl, staleTime: 10 * 60_000 })
  const approve = useMutation({
    mutationFn: serviceApi.approveSite,
    onSuccess: async () => {
      setApproving(false)
      toast.show(cust.site.approved)
      onApproved()
      await queryClient.invalidateQueries({ queryKey: ['service-overview'] })
    },
    onError: showError,
  })
  return (
    <div className="stack-lg">
      <Card className="cust-next">
        <h2 className="cust-next__title">{cust.site.reviewTitle}</h2>
        <p className="cust-next__body">{cust.site.reviewDesc}</p>
        <div className="row-wrap">
          <Button icon={Check} onClick={() => setApproving(true)} size="lg" variant="primary">
            {cust.site.approve}
          </Button>
          <Button icon={PencilLine} onClick={() => setChanging(true)} size="lg" variant="secondary">
            {cust.site.change}
          </Button>
        </div>
      </Card>
      <Tabs
        items={[
          { value: 'desktop', label: <span className="row"><Monitor aria-hidden size={14} />{cust.site.desktop}</span> },
          { value: 'mobile', label: <span className="row"><Smartphone aria-hidden size={14} />{cust.site.mobile}</span> },
        ]}
        label={cust.site.title}
        onChange={setMode}
        value={mode}
      />
      {preview.data ? (
        <div className={cx('site-preview', `is-${mode}`)} data-mode={mode}>
          <div className="site-preview__frame">
            <iframe referrerPolicy="no-referrer" sandbox="" src={preview.data.url} title={cust.site.title} />
          </div>
        </div>
      ) : (
        <Centered>
          <Spinner />
        </Centered>
      )}
      <ConfirmDialog
        body={cust.site.approveConfirm}
        cancelLabel="再看看"
        confirmLabel={cust.site.approve}
        loading={approve.isPending}
        onCancel={() => setApproving(false)}
        onConfirm={() => approve.mutate()}
        open={approving}
        title={cust.site.approve}
      />
      <ChangeRequest onClose={() => setChanging(false)} open={changing} />
    </div>
  )
}

function ChangeRequest({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast()
  const showError = useErrorToast()
  const queryClient = useQueryClient()
  const [text, setText] = useState('')
  const [files, setFiles] = useState<Asset[]>([])
  const [uploading, setUploading] = useState(false)
  const send = useMutation({
    mutationFn: () => serviceApi.requestChange({ text: text.trim(), asset_ids: files.map((f) => f.id) }),
    onSuccess: async () => {
      toast.show(cust.site.changeSent)
      setText('')
      setFiles([])
      onClose()
      await queryClient.invalidateQueries({ queryKey: ['service-overview'] })
    },
    onError: showError,
  })
  async function attach(list: FileList | null) {
    if (!list?.length) return
    setUploading(true)
    try {
      for (const file of Array.from(list).slice(0, 5)) {
        try {
          const asset = await api.uploadAsset(file, 'image')
          setFiles((prev) => [...prev, asset])
        } catch (error) {
          showError(error)
        }
      }
    } finally {
      setUploading(false)
    }
  }
  return (
    <FormModal
      description={cust.site.changeDesc}
      loading={send.isPending}
      onClose={onClose}
      onPrimary={() => send.mutate()}
      onSecondary={onClose}
      open={open}
      primaryDisabled={text.trim().length < 2 || uploading}
      primaryLabel="提交"
      secondaryLabel="取消"
      title={cust.site.changeTitle}
    >
      <TextArea label={cust.site.changeLabel} maxLength={2000} onChange={setText} placeholder={cust.site.changePlaceholder} rows={5} value={text} />
      <label className="attach">
        <span>{cust.site.changeAttach}</span>
        <input accept="image/jpeg,image/png,image/webp" multiple onChange={(e) => void attach(e.target.files)} type="file" />
      </label>
      {uploading ? <Spinner size={16} /> : null}
      {files.length ? (
        <ul className="material__files">
          {files.map((f) => (
            <li className="material__file" key={f.id}>
              <AssetThumb asset={f} />
            </li>
          ))}
        </ul>
      ) : null}
    </FormModal>
  )
}

function LiveSite({ url }: { url: string }) {
  const toast = useToast()
  const session = useSession()
  const inquiries = useQuery({ queryKey: ['inquiries', session.company?.id], queryFn: () => siteApi.inquiries(20) })
  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      toast.show(cust.site.copied)
    } catch {
      toast.show(url)
    }
  }
  const items = (inquiries.data ?? []).filter((i) => i.status !== 'spam')
  return (
    <div className="stack-lg">
      <Card className="cust-next">
        <h2 className="cust-next__title">{cust.site.liveTitle}</h2>
        <p className="cust-next__body">{cust.site.liveDesc}</p>
        <p className="cust-url">{url}</p>
        <div className="row-wrap">
          <Button icon={Copy} onClick={() => void copy()} variant="primary">
            {cust.site.copy}
          </Button>
          <a className="ui-btn ui-btn--secondary ui-btn--md" href={url} rel="noopener noreferrer" target="_blank">
            <ExternalLink aria-hidden size={16} />
            <span>{cust.site.open}</span>
          </a>
        </div>
      </Card>
      <ListGroup title={cust.site.inquiriesTitle}>
        {inquiries.isPending ? (
          <ListRow title={<Spinner size={16} />} />
        ) : items.length ? (
          items.map((i) => (
            <ListRow
              key={i.id}
              subtitle={i.message.slice(0, 120)}
              title={cust.site.inquiryFrom(i.company_name || i.name, i.country)}
              value={new Date(i.created_at).toLocaleDateString('zh-CN')}
            />
          ))
        ) : (
          <ListRow subtitle={cust.site.inquiriesEmpty} title="—" />
        )}
      </ListGroup>
    </div>
  )
}
