// 欢迎页建议任务：根据档案完整度等状态动态生成（纯函数，便于测试）。
import { t } from '@/i18n'

export interface WelcomeContext {
  completeness: number | null
  hasSite: boolean
  hasWatch: boolean
  newLeads: number
}

export function welcomeSuggestions(ctx: WelcomeContext): string[] {
  const items: string[] = []
  if (ctx.newLeads > 0) items.push(t.assistant.suggestTodayLeads)
  if (ctx.completeness === null || ctx.completeness < 80) items.push(t.assistant.suggestProfile)
  if (!ctx.hasSite) items.push(t.assistant.suggestSite)
  if (!ctx.hasWatch) items.push(t.assistant.suggestLeads)
  return items.slice(0, 4)
}
