// TabBar「商机」图标上的未读数：复核通过但当前用户尚未查看的商机数量。
import { useQuery } from '@tanstack/react-query'
import { useSession } from '@/session/session'
import { leadsApi } from './api'

export function useLeadBadge(): number {
  const session = useSession()
  const query = useQuery({
    queryKey: ['leads', session.company?.id, 'badge'],
    queryFn: () => leadsApi.list({}, 0),
    enabled: Boolean(session.company),
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  })
  return query.data?.new_count ?? 0
}
