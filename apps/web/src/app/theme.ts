import { useEffect, useState } from 'react'

export type Theme = 'light' | 'dark'

const query = '(prefers-color-scheme: dark)'

/** 跟随系统深浅色偏好。首发只验收 Light，Dark 依赖设计包 tokens 中的 [data-theme="dark"]。 */
export function useSystemTheme(): Theme {
  const [theme, setTheme] = useState<Theme>(() =>
    typeof window !== 'undefined' && window.matchMedia(query).matches ? 'dark' : 'light',
  )
  useEffect(() => {
    const media = window.matchMedia(query)
    const onChange = () => setTheme(media.matches ? 'dark' : 'light')
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])
  return theme
}
