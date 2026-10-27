import { createContext, useContext, type ReactNode } from 'react'

export type RenderPolicy = 'catalog-preview' | 'deliverable-strict'
const PolicyContext = createContext<RenderPolicy>('catalog-preview')
export function RenderPolicyProvider({ children, policy }: { children: ReactNode; policy: RenderPolicy }) {
  return <PolicyContext.Provider value={policy}>{children}</PolicyContext.Provider>
}
export function useRenderPolicy() { return useContext(PolicyContext) }
