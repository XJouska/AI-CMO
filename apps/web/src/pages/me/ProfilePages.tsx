// 企业档案：完整度与缺失项、分区列表、分区编辑。
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, FormDoubleLine, FormSingleLine, ListSectionTitle, SettingsFullWidthItem } from '@yb/generated/components'
import { useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { api, type Profile, type ProfilePatch, type ProfileSection } from '@/api/endpoints'
import { QueryView } from '@/components/local/QueryView'
import { StackPage } from '@/components/local/StackPage'
import { useToast } from '@/feedback/toast'
import { useErrorToast } from '@/feedback/useErrorToast'
import { t } from '@/i18n'
import { joinList, parseYear, splitList } from '@/lib/validation'
import { useSession } from '@/session/session'

type FieldKind = 'text' | 'long' | 'list' | 'year'

interface FieldDef {
  key: string
  label: string
  kind: FieldKind
  max: number
  placeholder?: string
}

export const SECTIONS: Record<ProfileSection, { title: string; fields: FieldDef[] }> = {
  basic: {
    title: t.profile.sectionBasic,
    fields: [
      { key: 'name_en', label: t.profile.nameEn, kind: 'text', max: 150 },
      { key: 'founded_year', label: t.profile.foundedYear, kind: 'year', max: 4, placeholder: t.profile.foundedYearPlaceholder },
      { key: 'employees', label: t.profile.employees, kind: 'text', max: 32 },
      { key: 'factory_area', label: t.profile.factoryArea, kind: 'text', max: 64 },
      { key: 'annual_capacity', label: t.profile.annualCapacity, kind: 'text', max: 200 },
    ],
  },
  market: {
    title: t.profile.sectionMarket,
    fields: [
      { key: 'export_markets', label: t.profile.exportMarkets, kind: 'list', max: 2000 },
      { key: 'main_customers_public', label: t.profile.mainCustomers, kind: 'list', max: 2000 },
    ],
  },
  certs: {
    title: t.profile.sectionCerts,
    fields: [{ key: 'certifications', label: t.profile.certifications, kind: 'list', max: 2000 }],
  },
  story: {
    title: t.profile.sectionStory,
    fields: [
      { key: 'usp', label: t.profile.usp, kind: 'long', max: 2000 },
      { key: 'about_en', label: t.profile.aboutEn, kind: 'long', max: 4000 },
    ],
  },
  contacts: {
    title: t.profile.sectionContacts,
    fields: [
      { key: 'contacts.email', label: t.profile.email, kind: 'text', max: 200 },
      { key: 'contacts.phone', label: t.profile.phone, kind: 'text', max: 200 },
      { key: 'contacts.whatsapp', label: t.profile.whatsapp, kind: 'text', max: 200 },
      { key: 'contacts.address', label: t.profile.address, kind: 'text', max: 200 },
      { key: 'contacts.website', label: t.profile.website, kind: 'text', max: 200 },
    ],
  },
}

export function fieldText(profile: Profile, key: string): string {
  if (key.startsWith('contacts.')) return profile.contacts[key.slice(9) as keyof Profile['contacts']] ?? ''
  const value = (profile as unknown as Record<string, unknown>)[key]
  if (Array.isArray(value)) return joinList(value as string[])
  return value === null || value === undefined ? '' : String(value)
}

/** 把表单草稿转换为 PATCH 请求体；年份非法时返回 null。只包含有变化的字段。 */
export function buildPatch(profile: Profile, fields: FieldDef[], draft: Record<string, string>): ProfilePatch | null {
  const patch: Record<string, unknown> = {}
  const contacts: Record<string, string> = {}
  for (const field of fields) {
    const text = draft[field.key] ?? ''
    if (text === fieldText(profile, field.key)) continue
    if (field.key.startsWith('contacts.')) contacts[field.key.slice(9)] = text.trim()
    else if (field.kind === 'list') patch[field.key] = splitList(text)
    else if (field.kind === 'year') {
      const year = parseYear(text)
      if (year === undefined) return null
      patch[field.key] = year
    } else patch[field.key] = text.trim()
  }
  if (Object.keys(contacts).length) patch.contacts = { ...profile.contacts, ...contacts }
  return patch as ProfilePatch
}

function useProfile() {
  const session = useSession()
  return useQuery({ queryKey: ['profile', session.company?.id], queryFn: api.profile })
}

export function ProfilePage() {
  const navigate = useNavigate()
  const query = useProfile()
  return (
    <StackPage backTo="/me" title={t.profile.title}>
      <QueryView query={query}>
        {(profile) => (
          <>
            <ListSectionTitle>{t.profile.completeness(profile.completeness)}</ListSectionTitle>
            {profile.missing.length ? (
              <section>
                <ListSectionTitle>{t.profile.missingTitle}</ListSectionTitle>
                {profile.missing.map((item) => (
                  <SettingsFullWidthItem
                    key={item.key}
                    onAction={(action) => action === 'open' && navigate(item.section === 'products' ? '/me/products' : `/me/profile/${item.section}`)}
                    trailing={`+${item.weight}%`}
                    trailingKind="chevron"
                    type="单行列表-常规"
                  >
                    {item.label}
                  </SettingsFullWidthItem>
                ))}
                <SettingsFullWidthItem onAction={(action) => action === 'press' && navigate('/onboarding')} type="居中按钮">
                  {t.profile.aiFill}
                </SettingsFullWidthItem>
              </section>
            ) : null}
            <ListSectionTitle>{t.profile.sections}</ListSectionTitle>
            {(Object.keys(SECTIONS) as ProfileSection[]).map((key) => {
              const filled = SECTIONS[key].fields.filter((field) => fieldText(profile, field.key).trim()).length
              return (
                <SettingsFullWidthItem
                  key={key}
                  onAction={(action) => action === 'open' && navigate(`/me/profile/${key}`)}
                  trailing={`${filled}/${SECTIONS[key].fields.length}`}
                  trailingKind="chevron"
                  type="单行列表-常规"
                >
                  {SECTIONS[key].title}
                </SettingsFullWidthItem>
              )
            })}
          </>
        )}
      </QueryView>
    </StackPage>
  )
}

export function ProfileSectionPage() {
  const { section = '' } = useParams()
  const query = useProfile()
  if (!(section in SECTIONS)) return <Navigate replace to="/me/profile" />
  const def = SECTIONS[section as ProfileSection]
  return (
    <QueryView query={query}>
      {(profile) => <SectionForm fields={def.fields} key={profile.company_id} profile={profile} title={def.title} />}
    </QueryView>
  )
}

function SectionForm({ profile, title, fields }: { profile: Profile; title: string; fields: FieldDef[] }) {
  const navigate = useNavigate()
  const toast = useToast()
  const showError = useErrorToast()
  const queryClient = useQueryClient()
  const session = useSession()
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((field) => [field.key, fieldText(profile, field.key)])),
  )
  const dirty = fields.some((field) => draft[field.key] !== fieldText(profile, field.key))
  const save = useMutation({
    mutationFn: (patch: ProfilePatch) => api.patchProfile(patch),
    onSuccess: (updated) => {
      queryClient.setQueryData(['profile', session.company?.id], updated)
      toast.show(t.common.saved)
      navigate('/me/profile', { replace: true })
    },
    onError: showError,
  })

  function submit() {
    if (!dirty || save.isPending) return
    const patch = buildPatch(profile, fields, draft)
    if (patch === null) return toast.show(t.profile.yearInvalid)
    save.mutate(patch)
  }

  return (
    <StackPage
      backTo="/me/profile"
      footer={
        <Button onAction={(a) => a === 'press' && submit()} size="L" state={dirty && !save.isPending ? 'Default' : 'Disable'} type="Primary">
          {t.common.save}
        </Button>
      }
      surface="primary"
      title={title}
    >
      <div className="form-stack">
        {fields.map((field) => {
          const common = {
            label: field.kind === 'list' ? `${field.label}（${t.common.listHint}）` : field.label,
            maxLength: field.max,
            onChange: (value: string) => setDraft((prev) => ({ ...prev, [field.key]: value })),
            placeholder: field.placeholder ?? field.label,
            value: draft[field.key] ?? '',
          }
          return field.kind === 'long' || field.kind === 'list' ? (
            <FormDoubleLine key={field.key} {...common} />
          ) : (
            <FormSingleLine align="left" key={field.key} {...common} />
          )
        })}
      </div>
    </StackPage>
  )
}
