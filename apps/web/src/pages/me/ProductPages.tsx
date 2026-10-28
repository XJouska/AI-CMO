// 产品管理：列表、新增 / 编辑（含图片上传）、删除。
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ImagePlus, Package, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { api, type Product, type ProductInput } from '@/api/endpoints'
import { QueryView } from '@/components/QueryView'
import { useErrorToast } from '@/feedback/useErrorToast'
import { t } from '@/i18n'
import { SettingsPage } from '@/layout/SettingsPage'
import { joinList, splitList } from '@/lib/validation'
import { useSession } from '@/session/session'
import { Button, Card, CardHeader, ConfirmDialog, ListRow, TextArea, TextField, useToast } from '@/ui'
import { useFilePicker } from '../onboarding/OnboardingPages'

export function ProductsPage() {
  const navigate = useNavigate()
  const session = useSession()
  const query = useQuery({ queryKey: ['products', session.company?.id], queryFn: api.products })
  const add = () => navigate('/me/products/new')
  return (
    <SettingsPage
      actions={
        query.data?.length ? (
          <Button icon={Plus} onClick={add} variant="primary">
            {t.products.add}
          </Button>
        ) : null
      }
      title={t.products.title}
    >
      <QueryView empty={{ title: t.products.emptyTitle, desc: t.products.emptyDesc, action: t.products.add, onAction: add, icon: Package }} isEmpty={(items) => items.length === 0} query={query}>
        {(items) => (
          <div className="ui-list">
            {items.map((product) => (
              <ListRow
                icon={Package}
                key={product.id}
                onClick={() => navigate(`/me/products/${product.id}`)}
                subtitle={[product.name_cn, product.category, joinList(product.keywords_en)].filter(Boolean).join(' · ') || undefined}
                title={product.name_en}
                value={t.products.imageCount(product.images.length)}
              />
            ))}
          </div>
        )}
      </QueryView>
    </SettingsPage>
  )
}

interface ProductDraft {
  name_en: string
  name_cn: string
  category: string
  keywords_en: string
  applications: string
  hs_codes: string
  moq: string
  lead_time: string
  images: string[]
}

export function toDraft(product?: Product): ProductDraft {
  return {
    name_en: product?.name_en ?? '',
    name_cn: product?.name_cn ?? '',
    category: product?.category ?? '',
    keywords_en: joinList(product?.keywords_en),
    applications: joinList(product?.applications),
    hs_codes: joinList(product?.hs_codes),
    moq: product?.moq ?? '',
    lead_time: product?.lead_time ?? '',
    images: product?.images ?? [],
  }
}

export function fromDraft(draft: ProductDraft): Partial<ProductInput> {
  return {
    name_en: draft.name_en.trim(),
    name_cn: draft.name_cn.trim(),
    category: draft.category.trim(),
    keywords_en: splitList(draft.keywords_en),
    applications: splitList(draft.applications),
    hs_codes: splitList(draft.hs_codes),
    moq: draft.moq.trim(),
    lead_time: draft.lead_time.trim(),
    images: draft.images,
  }
}

export function ProductEditPage() {
  const { id } = useParams()
  const isNew = !id || id === 'new'
  const query = useQuery({ queryKey: ['product', id], queryFn: () => api.product(id ?? ''), enabled: !isNew })
  return (
    <SettingsPage back="/me/products" title={isNew ? t.products.newTitle : t.products.editTitle}>
      {isNew ? <ProductForm /> : <QueryView query={query}>{(product) => <ProductForm key={product.id} product={product} />}</QueryView>}
    </SettingsPage>
  )
}

function ProductForm({ product }: { product?: Product }) {
  const navigate = useNavigate()
  const toast = useToast()
  const showError = useErrorToast()
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState<ProductDraft>(() => toDraft(product))
  const [confirmDelete, setConfirmDelete] = useState(false)
  const picker = useFilePicker('image', (asset) => setDraft((prev) => ({ ...prev, images: [...prev.images, asset.id].slice(0, 12) })))
  const set = (key: keyof ProductDraft) => (value: string) => setDraft((prev) => ({ ...prev, [key]: value }))
  const dirty = JSON.stringify(draft) !== JSON.stringify(toDraft(product))

  const done = async (message: string) => {
    await queryClient.invalidateQueries({ queryKey: ['products'] })
    await queryClient.invalidateQueries({ queryKey: ['profile'] })
    toast.show(message)
    navigate('/me/products', { replace: true })
  }
  const save = useMutation({
    mutationFn: () => (product ? api.patchProduct(product.id, fromDraft(draft)) : api.createProduct(fromDraft(draft))),
    onSuccess: () => done(t.common.saved),
    onError: showError,
  })
  const remove = useMutation({
    mutationFn: () => api.deleteProduct(product?.id ?? ''),
    onSuccess: () => done(t.common.deleted),
    onError: showError,
  })

  function submit() {
    if (!dirty || save.isPending) return
    if (!draft.name_en.trim()) return toast.show(t.products.nameRequired)
    save.mutate()
  }

  return (
    <div className="stack-lg">
      {picker.element}
      <Card padding="lg">
        <form
          className="ui-form-stack"
          onSubmit={(event) => {
            event.preventDefault()
            submit()
          }}
        >
          <div className="ui-form-grid">
            <TextField label={t.products.nameEn} maxLength={200} onChange={set('name_en')} placeholder="Stainless Steel Ball Valve" value={draft.name_en} />
            <TextField label={t.products.nameCn} maxLength={100} onChange={set('name_cn')} placeholder={t.products.nameCn} value={draft.name_cn} />
            <TextField label={t.products.category} maxLength={100} onChange={set('category')} placeholder={t.products.category} value={draft.category} />
            <TextField label={t.products.hsCodes} maxLength={200} onChange={set('hs_codes')} placeholder="848180" value={draft.hs_codes} />
            <TextField label={t.products.moq} maxLength={100} onChange={set('moq')} placeholder="100 pcs" value={draft.moq} />
            <TextField label={t.products.leadTime} maxLength={100} onChange={set('lead_time')} placeholder="25 days" value={draft.lead_time} />
          </div>
          <TextArea hint={t.common.listHint} label={t.products.keywords} maxLength={2000} onChange={set('keywords_en')} placeholder="ball valve, industrial valve" rows={2} value={draft.keywords_en} />
          <TextArea hint={t.common.listHint} label={t.products.applications} maxLength={2000} onChange={set('applications')} placeholder={t.products.applications} rows={2} value={draft.applications} />
        </form>
      </Card>
      <Card>
        <CardHeader
          actions={
            <Button icon={ImagePlus} loading={picker.uploading} onClick={picker.open} size="sm" variant="outline">
              {t.products.addImage}
            </Button>
          }
          description={t.products.imageCount(draft.images.length)}
          title={t.products.images}
        />
      </Card>
      <div className="row-between">
        {product ? (
          <Button icon={Trash2} onClick={() => setConfirmDelete(true)} variant="danger-ghost">
            {t.common.delete}
          </Button>
        ) : (
          <span />
        )}
        <div className="row">
          <Button onClick={() => navigate('/me/products')} variant="ghost">
            {t.common.cancel}
          </Button>
          <Button disabled={!dirty} loading={save.isPending} onClick={submit} variant="primary">
            {t.common.save}
          </Button>
        </div>
      </div>
      <ConfirmDialog
        body={t.products.deleteDesc}
        cancelLabel={t.common.cancel}
        confirmLabel={t.common.delete}
        danger
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => {
          setConfirmDelete(false)
          remove.mutate()
        }}
        open={confirmDelete}
        title={t.products.deleteConfirm}
      />
    </div>
  )
}
