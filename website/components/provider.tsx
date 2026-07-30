'use client'
import SearchDialog from '@/components/search'
import { RootProvider } from 'fumadocs-ui/provider/next'
import type { ReactNode } from 'react'

/**
 * Provides the application context and search interface for its child content.
 *
 * @param children - The content rendered within the provider.
 */
export function Provider({ children }: { children: ReactNode }) {
  return <RootProvider search={{ SearchDialog }}>{children}</RootProvider>
}
