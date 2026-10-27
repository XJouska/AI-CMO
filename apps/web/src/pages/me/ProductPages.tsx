// 产品管理：列表、新增 / 编辑（含图片上传）、删除。
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, FormDoubleLine, FormSingleLine, ListSectionTitle, SettingsFullWidthItem } from '@yb/generated/components'
import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { api, type Product, type ProductInput } from '@/api/endpoints'
import { QueryView } from '@/components/local/QueryView'
import { StackPage } from '@/components/local/StackPage'
import { ConfirmDialog } from '@/feedback/overlays'
import { useToast } from '@/feedback/toast'
import { useErrorToast } from '@/feedback/useErrorToast'
import { t } from '@/i18n'
import { joinList, splitList } from '@/lib/validation'
import { useSession } from '@/session/session'
import { useFilePicker } from '../onboarding/OnboardingPages'

export function ProductsPage() {
  const navigate = useNavigate()
  const session = useSession()
  const query = useQuery({ queryKey: ['products', session.company?.id], queryFn: api.products })
  const add = () => navigate('/me/products/new')
  return (
    <StackPage
      backTo="/me"
      footer={
        query.data?.length ? (
          <Button onAction={(a) => a === 'press' && add()} size="L" type="Primary">
            {t.products.add}
          </Button>
        ) : undefined
      }
      title={t.products.title}
    >
      <QueryView
        empty={{ title: t.products.emptyTitle, desc: t.products.emptyDesc, action: t.products.add, onAction: add }}
        isEmpty={(items) => items.length === 0}
        query={query}
      >
        {(items) => (
          <div className="list-block">
            {items.map((product) => (
              <SettingsFullWidthItem
                key={product.id}
                onAction={(action) => action === 'open' && navigate(`/me/products/${product.id}`)}
                subtitle={[product.name_cn, product.category, joinList(product.keywords_en)].filter(Boolean).join(' · ') || ' '}
                trailing={t.products.imageCount(product.images.length)}
                trailingKind="chevron"
                type="双行列表-常规"
              >
                {product.name_en}
              </SettingsFullWidthItem>
            ))}
          </div>
        )}
      </QueryView>
    </StackPage>
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
  if (isNew) return <ProductForm />
  return <QueryView query={query}>{(product) => <ProductForm key={product.id} product={product} />}</QueryView>
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
    <StackPage
      backTo="/me/products"
      footer={
        <div className="form-actions">
          <Button onAction={(a) => a === 'press' && submit()} size="L" state={dirty && !save.isPending ? 'Default' : 'Disable'} type="Primary">
            {t.common.save}
          </Button>
          {product ? (
            <Button onAction={(a) => a === 'press' && setConfirmDelete(true)} size="M" type="Text">
              {t.common.delete}
            </Button>
          ) : null}
        </div>
      }
      surface="primary"
      title={product ? t.products.editTitle : t.products.newTitle}
    >
      {picker.element}
      <div className="form-stack">
        <FormSingleLine align="left" label={t.products.nameEn} maxLength={200} onChange={set('name_en')} placeholder="Stainless Steel Ball Valve" value={draft.name_en} />
        <FormSingleLine align="left" label={t.products.nameCn} maxLength={100} onChange={set('name_cn')} placeholder={t.products.nameCn} value={draft.name_cn} />
        <FormSingleLine align="left" label={t.products.category} maxLength={100} onChange={set('category')} placeholder={t.products.category} value={draft.category} />
        <FormDoubleLine label={`${t.products.keywords}（${t.common.listHint}）`} maxLength={2000} onChange={set('keywords_en')} placeholder="ball valve, industrial valve" value={draft.keywords_en} />
        <FormDoubleLine label={`${t.products.applications}（${t.common.listHint}）`} maxLength={2000} onChange={set('applications')} placeholder={t.products.applications} value={draft.applications} />
        <FormSingleLine align="left" label={t.products.hsCodes} maxLength={200} onChange={set('hs_codes')} placeholder="848180" value={draft.hs_codes} />
        <FormSingleLine align="left" label={t.products.moq} maxLength={100} onChange={set('moq')} placeholder="100 pcs" value={draft.moq} />
        <FormSingleLine align="left" label={t.products.leadTime} maxLength={100} onChange={set('lead_time')} placeholder="25 days" value={draft.lead_time} />
      </div>
      <ListSectionTitle>{t.products.images}</ListSectionTitle>
      <SettingsFullWidthItem
        onAction={(action) => action === 'open' && !picker.uploading && picker.open()}
        trailing={picker.uploading ? t.onboarding.uploading : t.products.imageCount(draft.images.length)}
        trailingKind="chevron"
        type="单行列表-常规"
      >
        {t.products.addImage}
      </SettingsFullWidthItem>
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
    </StackPage>
  )
}
