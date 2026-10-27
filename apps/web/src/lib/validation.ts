// 表单校验（纯函数，便于单元测试）。规范 form-validation-timing：
// 信息不完整时主按钮置灰；格式错误在点击提交时用 Toast 提示，不在输入框旁显示红字。

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export function isEmail(value: string): boolean {
  return EMAIL_RE.test(value.trim())
}

/** 密码至少 8 位，同时包含字母和数字（与后端规则一致）。返回错误文案键，通过时返回 null。 */
export function passwordProblem(value: string): 'tooShort' | 'needMix' | null {
  if (value.length < 8) return 'tooShort'
  if (!/[A-Za-z]/.test(value) || !/\d/.test(value)) return 'needMix'
  return null
}

/** 规范化网址：允许用户省略协议；只接受 http / https。无效时返回 null。 */
export function normalizeUrl(raw: string): string | null {
  const value = raw.trim()
  if (!value) return null
  const withScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(value) ? value : `https://${value}`
  let url: URL
  try {
    url = new URL(withScheme)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  if (!url.hostname.includes('.')) return null
  return url.toString()
}

/** 逗号 / 顿号 / 换行分隔的列表 → 去重去空数组 */
export function splitList(value: string): string[] {
  const parts = value
    .split(/[,，、;；\n]/)
    .map((part) => part.trim())
    .filter(Boolean)
  return Array.from(new Set(parts))
}

export function joinList(values: readonly string[] | undefined): string {
  return (values ?? []).join(', ')
}

/** 成立年份：空字符串表示清空；非法时返回 undefined */
export function parseYear(value: string, now = new Date().getFullYear()): number | null | undefined {
  const trimmed = value.trim()
  if (!trimmed) return null
  if (!/^\d{4}$/.test(trimmed)) return undefined
  const year = Number(trimmed)
  return year >= 1900 && year <= now ? year : undefined
}
