import type { ReactNode } from 'react'

interface Props {
  url: string
  children: ReactNode
}

export function BrowserChromeFrame({ url, children }: Props) {
  return (
    <div className="flex h-full w-full flex-col overflow-hidden rounded-xl border border-border bg-surface">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-3">
        <div className="flex items-center gap-1.5">
          <span aria-hidden className="h-2.5 w-2.5 rounded-full bg-red-400" />
          <span aria-hidden className="h-2.5 w-2.5 rounded-full bg-amber-400" />
          <span aria-hidden className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
        </div>
        <div
          className="ml-2 flex-1 truncate rounded-md bg-elevated px-2 py-1 text-[11px] text-text-muted"
          title={url}
        >
          {url}
        </div>
      </div>
      <div className="relative flex-1 min-h-0 overflow-hidden">{children}</div>
    </div>
  )
}
