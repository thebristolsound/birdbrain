import Link from 'next/link'
import { appName, docsRoute, gitConfig } from '@/lib/shared'

export default function HomePage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 py-24 text-center">
      <h1 className="text-4xl font-semibold tracking-tight">{appName}</h1>
      <p className="mt-4 max-w-xl text-fd-muted-foreground">
        Local-first web evidence capture for OSINT investigations. Every capture is hashed,
        timestamped, and chained into a verifiable audit manifest.
      </p>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <Link
          href={docsRoute}
          className="rounded-lg bg-fd-primary px-4 py-2 text-sm font-medium text-fd-primary-foreground"
        >
          Read the docs
        </Link>
        <a
          href={`https://github.com/${gitConfig.user}/${gitConfig.repo}`}
          className="rounded-lg border border-fd-border px-4 py-2 text-sm font-medium"
        >
          View on GitHub
        </a>
      </div>
    </main>
  )
}
