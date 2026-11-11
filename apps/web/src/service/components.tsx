// 客户页面共用组件：分类上传资料、服务进度条、网站风格选择。
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Camera, Check, FileText, ImagePlus, Trash2 } from 'lucide-react'
import { ApiError } from '@/api/client'
import { useEffect, useRef, useState } from 'react'
import { api, type Asset } from '@/api/endpoints'
import { useErrorToast } from '@/feedback/useErrorToast'
import { cust } from '@/i18n/customer'
import { useSession } from '@/session/session'
import { Button, ConfirmDialog, cx, IconButton, Spinner } from '@/ui'
import { MATERIAL_TIPS, serviceApi, type MaterialCategory, type Overview, type StyleChoice } from './api'

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024
const IMAGES = 'image/jpeg,image/png,image/webp'
const IMAGES_AND_PDF = `${IMAGES},application/pdf`

export function useAssets() {
  const session = useSession()
  return useQuery({ queryKey: ['assets', session.company?.id], queryFn: () => api.assets(), enabled: Boolean(session.company) })
}

interface UploadItem {
  id: number
  name: string
  status: 'uploading' | 'done' | 'failed'
  error?: string
}

let uploadSeq = 0

/**
 * 一个资料类别：整张卡片都能点（或把文件拖进来）上传；写清「拍什么」和「用在哪」；
 * 每个文件单独显示「上传中 / 已上传 / 失败原因」，上传完立刻出现缩略图。
 */
export function MaterialSection({ category, assets }: { category: MaterialCategory; assets: Asset[] }) {
  const queryClient = useQueryClient()
  const showError = useErrorToast()
  const pick = useRef<HTMLInputElement>(null)
  const camera = useRef<HTMLInputElement>(null)
  const [items, setItems] = useState<UploadItem[]>([])
  const [dragging, setDragging] = useState(false)
  const [deleting, setDeleting] = useState<Asset | null>(null)
  const tip = MATERIAL_TIPS[category.key]
  const accept = category.images_only ? IMAGES : IMAGES_AND_PDF
  const busy = items.some((i) => i.status === 'uploading')

  async function upload(files: File[]) {
    if (!files.length) return
    const queued = files.map((f) => ({ id: ++uploadSeq, name: f.name, status: 'uploading' as const }))
    setItems((prev) => [...prev.filter((i) => i.status !== 'done'), ...queued])
    for (const [index, file] of files.entries()) {
      const id = queued[index].id
      let result: Partial<UploadItem>
      if (file.size > MAX_UPLOAD_BYTES) {
        result = { status: 'failed', error: cust.upload.tooBig }
      } else if (category.images_only && !file.type.startsWith('image/')) {
        result = { status: 'failed', error: cust.upload.imagesOnly }
      } else {
        try {
          await api.uploadAsset(file, category.key)
          result = { status: 'done' }
          await queryClient.invalidateQueries({ queryKey: ['assets'] })
        } catch (error) {
          result = { status: 'failed', error: error instanceof ApiError && error.message ? error.message : cust.upload.failedRetry }
        }
      }
      setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...result } : i)))
    }
    await queryClient.invalidateQueries({ queryKey: ['service-overview'] })
  }

  const remove = useMutation({
    mutationFn: (id: string) => api.deleteAsset(id),
    onSuccess: async () => {
      setDeleting(null)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['assets'] }),
        queryClient.invalidateQueries({ queryKey: ['service-overview'] }),
      ])
    },
    onError: showError,
  })

  const done = assets.length > 0
  const failed = items.filter((i) => i.status === 'failed')
  return (
    <section className={cx('material', done && 'is-done', dragging && 'is-dragging')} data-kind={category.key}>
      <div className="material__head">
        <span aria-hidden className="material__check">{done ? <Check size={14} /> : null}</span>
        <div className="material__title">
          <h3>{category.label}</h3>
          <span className={cx('material__badge', category.recommended && 'is-recommended')}>{category.recommended ? cust.start.recommended : cust.start.optional}</span>
        </div>
        <span className="material__count">{done ? cust.upload.uploaded(assets.length) : ''}</span>
      </div>
      <p className="material__use">{tip.use}</p>

      <input accept={accept} aria-label={`${cust.upload.add}${category.label}`} hidden multiple onChange={(e) => void upload(Array.from(e.target.files ?? [])).finally(() => (e.target.value = ''))} ref={pick} type="file" />
      <input accept="image/*" aria-hidden capture="environment" hidden onChange={(e) => void upload(Array.from(e.target.files ?? [])).finally(() => (e.target.value = ''))} ref={camera} tabIndex={-1} type="file" />

      <div className="material__grid">
        {assets.map((asset) => (
          <div className="material__file" key={asset.id}>
            <AssetThumb asset={asset} />
            <IconButton className="material__delete" icon={Trash2} label={`${cust.upload.delete} ${asset.display_name}`} onClick={() => setDeleting(asset)} size="sm" />
          </div>
        ))}
        {items
          .filter((i) => i.status === 'uploading')
          .map((i) => (
            <div className="material__file material__file--pending" key={i.id} title={i.name}>
              <Spinner size={18} />
              <span>{cust.upload.uploadingOne}</span>
            </div>
          ))}
        <button
          className={cx('material__drop', !done && !busy && 'is-empty')}
          disabled={busy}
          onClick={() => pick.current?.click()}
          onDragLeave={() => setDragging(false)}
          onDragOver={(e) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDrop={(e) => {
            e.preventDefault()
            setDragging(false)
            void upload(Array.from(e.dataTransfer.files))
          }}
          type="button"
        >
          <ImagePlus aria-hidden size={done ? 20 : 26} />
          <span className="material__drop-title">{done ? cust.upload.addMore : cust.upload.choose}</span>
          {done ? null : <span className="material__drop-tip">{tip.tip}</span>}
          {done ? null : <span className="material__drop-hint">{category.images_only ? cust.upload.hintImages : cust.upload.hintFiles}</span>}
        </button>
      </div>

      {tip.capture ? (
        <Button className="only-touch material__camera" disabled={busy} icon={Camera} onClick={() => camera.current?.click()} variant="secondary">
          {cust.upload.takePhoto}
        </Button>
      ) : null}

      <div aria-live="polite" className="material__status">
        {busy ? cust.upload.uploading(items.filter((i) => i.status === 'uploading').length) : null}
        {!busy && items.some((i) => i.status === 'done') && !failed.length ? (
          <span className="material__ok">
            <Check aria-hidden size={14} /> {cust.upload.savedOk}
          </span>
        ) : null}
        {failed.map((i) => (
          <span className="material__err" key={i.id}>
            {cust.upload.failed(i.name)}：{i.error}
          </span>
        ))}
      </div>

      <ConfirmDialog
        body={deleting?.display_name}
        cancelLabel="取消"
        confirmLabel={cust.upload.delete}
        danger
        loading={remove.isPending}
        onCancel={() => setDeleting(null)}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
        open={deleting !== null}
        title={cust.upload.deleteConfirm}
      />
    </section>
  )
}

/** 图片显示缩略图（签名链接，短时有效）；PDF 显示文件名。 */
export function AssetThumb({ asset }: { asset: Asset }) {
  const isImage = asset.mime.startsWith('image/')
  const url = useQuery({ queryKey: ['asset-url', asset.id], queryFn: () => api.assetUrl(asset.id), enabled: isImage, staleTime: 20 * 60_000 })
  if (isImage && url.data) return <img alt={asset.display_name} className="material__thumb" height={72} loading="lazy" src={url.data.url} width={72} />
  return (
    <span className="material__thumb material__thumb--file" title={asset.display_name}>
      <FileText aria-hidden size={20} />
      <span>{asset.display_name}</span>
    </span>
  )
}

export function MaterialList({ categories, assets }: { categories: MaterialCategory[]; assets: Asset[] }) {
  return (
    <div className="materials">
      {categories.map((c) => (
        <MaterialSection assets={assets.filter((a) => a.kind === c.key)} category={c} key={c.key} />
      ))}
    </div>
  )
}

/** 已上传概况：每类传了几张（全部可选，只是提示建议补充的类别）。 */
export function MaterialChecklist({ categories, counts }: { categories: MaterialCategory[]; counts: Overview['materials'] }) {
  const recommended = categories.filter((c) => c.recommended)
  const allDone = recommended.every((c) => (counts[c.key] ?? 0) > 0)
  return (
    <div className="checklist" aria-live="polite">
      <p className="checklist__title">{allDone ? cust.start.checklistDone : cust.start.checklistTitle}</p>
      <ul>
        {recommended.map((c) => {
          const ok = (counts[c.key] ?? 0) > 0
          return (
            <li className={cx(ok && 'is-done')} key={c.key}>
              <span aria-hidden className="checklist__box">{ok ? <Check size={12} /> : null}</span>
              {c.label}
              <span className="sr-only">{ok ? '（已上传）' : '（还没上传）'}</span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/** 服务进度条：五个阶段，横向（手机上纵向）。 */
export function StageTrack({ stages }: { stages: Overview['stages'] }) {
  return (
    <ol className="stage-track" aria-label="服务进度">
      {stages.map((s, i) => (
        <li aria-current={s.state === 'current' ? 'step' : undefined} className={cx('stage-track__item', `is-${s.state}`)} key={s.key}>
          <span aria-hidden className="stage-track__dot">{s.state === 'done' ? <Check size={14} /> : i + 1}</span>
          <span className="stage-track__label">{s.label}</span>
        </li>
      ))}
    </ol>
  )
}

/** 网站风格选择：六张样图 + 「按我们工厂自己的风格」。样图用纯 CSS 画出版式差异，不依赖外部图片。 */
export function StylePicker({ value, onChange }: { value: StyleChoice | ''; onChange: (value: StyleChoice) => void }) {
  const catalog = useQuery({ queryKey: ['site-styles'], queryFn: serviceApi.styles, staleTime: Infinity })
  const layouts = catalog.data?.layouts ?? []
  return (
    <div aria-label="网站风格" className="style-grid" role="radiogroup">
      {layouts.map((l) => (
        <button aria-checked={value === l.key} className={cx('style-card', value === l.key && 'is-selected')} key={l.key} onClick={() => onChange(l.key)} role="radio" type="button">
          <StyleSample accent={l.accent} layout={l.key} primary={l.primary} />
          <span className="style-card__name">{l.label}</span>
          <span className="style-card__desc">{l.desc}</span>
        </button>
      ))}
      <button aria-checked={value === 'own'} className={cx('style-card style-card--own', value === 'own' && 'is-selected')} onClick={() => onChange('own')} role="radio" type="button">
        <span aria-hidden className="style-sample style-sample--own">
          <span>Logo</span>
        </span>
        <span className="style-card__name">{cust.start.styleOwn}</span>
        <span className="style-card__desc">{cust.start.styleOwnDesc}</span>
      </button>
      {catalog.isPending ? <Spinner /> : null}
    </div>
  )
}

function StyleSample({ layout, primary, accent }: { layout: string; primary: string; accent: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  // 颜色来自后端预设（#rrggbb），用 CSS 变量传入
  useEffect(() => {
    ref.current?.style.setProperty('--s-primary', primary)
    ref.current?.style.setProperty('--s-accent', accent)
  }, [primary, accent])
  return (
    <span aria-hidden className={cx('style-sample', `style-sample--${layout}`)} ref={ref}>
      <span className="ss-nav" />
      <span className="ss-hero">
        <span className="ss-title" />
        <span className="ss-line" />
        <span className="ss-btn" />
        <span className="ss-img" />
      </span>
      <span className="ss-cards">
        <span />
        <span />
        <span />
      </span>
    </span>
  )
}

export function useOverview(options: { poll?: boolean } = {}) {
  const session = useSession()
  return useQuery({
    queryKey: ['service-overview', session.company?.id],
    queryFn: serviceApi.overview,
    enabled: Boolean(session.company),
    // 客户确认上线后网站在后台发布、填完产品后 AI 在后台整理：这些时候定时刷新进度
    refetchInterval: (q) => (options.poll || q.state.data?.buyers.state === 'preparing' ? 3000 : false),
  })
}
