import type { Metadata } from 'next'
import { Provider } from '@/components/provider'
import { appName } from '@/lib/shared'
import './global.css'

export const metadata: Metadata = {
  title: {
    default: `${appName} docs`,
    template: `%s — ${appName}`
  },
  description:
    'Documentation for Birdbrain, a local-first web evidence capture tool for OSINT investigations.'
}

export default function Layout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="flex flex-col min-h-screen">
        <Provider>{children}</Provider>
      </body>
    </html>
  )
}
