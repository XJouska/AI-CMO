// 客户页面共用组件：分类上传资料、服务进度条、网站风格选择。
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Camera, Check, FileText, ImagePlus, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { api, type Asset } from '@/api/endpoints'
import { useErrorToast } from '@/feedback/useErrorToast'
import { cust } from '@/i18n/customer'
import { useSession } from '@/session/session'
import { Button, ConfirmDialog, cx, IconButton, Spinner, useToast } from '@/ui'
import { MATERIAL_TIPS, serviceApi, type MaterialCategory, type Overview, type StyleChoice } from './api'

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024
const IMAGES = 'image/jpeg,image/png,image/webp'
const IMAGES_AND_PDF = `${IMAGES},application/pdf`

export function useAssets() {
  const session = useSession()
  return useQuery({ queryKey: ['assets', session.company?.id], queryFn: () => api.assets(), enabled: Boolean(session.company) })
}

/** 一个资料类别：说明 + 已上传的缩略图 + 「上传」「拍照」按钮。 */
export function MaterialSection({ category, assets }: { category: MaterialCategory; assets: Asset[] }) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const showError = useErrorToast()
  const pick = useRef<HTMLInputElement>(null)
  const camera = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(0)
  const [deleting, setDeleting] = useState<Asset | null>(null)
  const tip = MATERIAL_TIPS[category.key]
  const accept = category.images_only ? IMAGES : IMAGES_AND_PDF

  async function upload(files: FileList | null, input: HTMLInputElement | null) {
    const list = Array.from(files ?? [])
    if (!list.length) return
    setUploading(list.length)
    try {
      for (const file of list) {
        if (file.size > MAX_UPLOAD_BYTES) {
          toast.show(cust.upload.tooLarge(file.name))
          continue
        }
        try {
          await api.uploadAsset(file, category.key)
        } catch (error) {
          showError(error)
        }
      }
    } finally {
      setUploading(0)
      if (input) input.value = ''
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['assets'] }),
        queryClient.invalidateQueries({ queryKey: ['service-overview'] }),
      ])
    }
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
  return (
    <section className={cx('material', done && 'is-done')} data-kind={category.key}>
      <div className="material__head">
        <span aria-hidden className="material__check">{done ? <Check size={14} /> : null}</span>
        <div className="material__title">
          <h3>{category.label}</h3>
          <span className={cx('material__badge', category.required && 'is-required')}>{category.required ? cust.start.required : cust.start.optional}</span>
        </div>
      </div>
      <p className="material__tip">{tip.tip}</p>
      {assets.length ? (
        <ul className="material__files" aria-label={category.label}>
          {assets.map((asset) => (
            <li className="material__file" key={asset.id}>
              <AssetThumb asset={asset} />
              <IconButton className="material__delete" icon={Trash2} label={`${cust.upload.delete} ${asset.display_name}`} onClick={() => setDeleting(asset)} size="sm" />
            </li>
          ))}
        </ul>
      ) : null}
      <div className="material__actions">
        <input accept={accept} aria-label={`${cust.upload.add}${category.label}`} hidden multiple onChange={(e) => void upload(e.target.files, e.target)} ref={pick} type="file" />
        <input accept="image/*" aria-hidden capture="environment" hidden onChange={(e) => void upload(e.target.files, e.target)} ref={camera} tabIndex={-1} type="file" />
        <Button disabled={uploading > 0} icon={ImagePlus} onClick={() => pick.current?.click()} variant={done ? 'secondary' : 'primary'}>
          {cust.upload.add}
        </Button>
        {tip.capture ? (
          <Button className="only-touch" disabled={uploading > 0} icon={Camera} onClick={() => camera.current?.click()} variant="secondary">
            {cust.upload.takePhoto}
          </Button>
        ) : null}
        <span className="material__status" role="status">
          {uploading ? (
            <>
              <Spinner size={14} /> {cust.upload.uploading(uploading)}
            </>
          ) : assets.length ? (
            cust.upload.uploaded(assets.length)
          ) : (
            cust.upload.none
          )}
        </span>
      </div>
      <ConfirmDialog
        cancelLabel="取消"
        confirmLabel={cust.upload.delete}
        danger
        loading={remove.isPending}
        onCancel={() => setDeleting(null)}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
        open={deleting !== null}
        title={cust.upload.deleteConfirm}
        body={deleting?.display_name}
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

/** 「还差什么」勾选清单。 */
export function MaterialChecklist({ categories, counts }: { categories: MaterialCategory[]; counts: Overview['materials'] }) {
  const required = categories.filter((c) => c.required)
  const allDone = required.every((c) => (counts[c.key] ?? 0) > 0)
  return (
    <div className="checklist" aria-live="polite">
      <p className="checklist__title">{allDone ? cust.start.checklistDone : cust.start.checklistTitle}</p>
      <ul>
        {required.map((c) => {
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
    // 客户确认上线后，网站在后台发布；发布完成前定时刷新进度
    refetchInterval: options.poll ? 3000 : false,
  })
}
