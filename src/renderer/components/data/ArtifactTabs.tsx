import { useState, type ReactNode } from 'react'
import { cn } from '@renderer/lib/utils'

export interface ArtifactTab {
  id: string
  label: string
  // A short right-aligned hint, like the mock's "n lines · extracted at capture".
  hint?: string
  content: ReactNode
}

interface ArtifactTabsProps {
  title: string
  subtitle: string
  tabs: ArtifactTab[]
  // Right-aligned control in the strip header — the row's Verify (#1151).
  action?: ReactNode
  // Selecting a row drives the strip (#1149). A tab absent from `tabs` is
  // absent, not empty (#1150): the strip only ever shows tabs with data.
}

// The per-row strip below the table. Tabs beyond Properties arrive with #1150;
// the strip already takes a list so that ticket adds entries, not markup.
export function ArtifactTabs({ title, subtitle, tabs, action }: ArtifactTabsProps) {
  // Only a tab the operator picked is remembered. Until then the strip shows
  // the leading tab, which it re-reads as tabs arrive: latching whatever
  // existed at mount opened it on the second tab once the text loaded (#1552).
  const [picked, setPicked] = useState<string | null>(null)
  const current = tabs.find((tab) => tab.id === picked) ?? tabs[0]

  return (
    <section
      className="flex min-h-0 min-w-0 flex-[1.2] flex-col border-t border-border bg-surface"
      data-testid="artifact-tabs"
    >
      <div className="flex h-[42px] shrink-0 items-center gap-2.5 border-b border-border px-3.5">
        <span className="font-mono text-xs font-semibold text-text-primary">{title}</span>
        <span
          className="min-w-0 truncate font-mono text-[11px] text-text-faint"
          data-testid="artifact-tabs-subtitle"
        >
          {subtitle}
        </span>
        <div className="flex-1" />
        {action}
      </div>
      <div
        role="tablist"
        className="flex h-[34px] shrink-0 items-center gap-0.5 border-b border-border bg-canvas px-2.5"
      >
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={tab.id === current?.id}
            onClick={() => setPicked(tab.id)}
            className={cn(
              'h-6 shrink-0 whitespace-nowrap rounded px-[11px] text-xs',
              tab.id === current?.id
                ? 'bg-elevated font-semibold text-text-primary'
                : 'font-medium text-text-muted hover:text-text-primary'
            )}
          >
            {tab.label}
          </button>
        ))}
        <div className="min-w-3 flex-1" />
        {current?.hint && (
          <span className="min-w-0 truncate text-[10px] text-text-faint">{current.hint}</span>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">{current?.content}</div>
    </section>
  )
}
