interface SourceRow {
  host: string
  count: number
  tone: string
}

interface SourcesBlockProps {
  sources: SourceRow[]
}

export function SourcesBlock({ sources }: SourcesBlockProps) {
  if (sources.length === 0) {
    return <p className="font-body text-xs text-text-faint">No sources captured yet.</p>
  }
  const max = Math.max(...sources.map((s) => s.count))
  return (
    <div className="flex flex-col gap-2.5">
      {sources.map((s) => (
        <div key={s.host} className="flex items-center gap-2.5">
          <span className="h-[7px] w-[7px] shrink-0 rounded-full" style={{ background: s.tone }} />
          <span className="w-36 shrink-0 truncate font-mono text-xs text-text-secondary">{s.host}</span>
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-elevated">
            <div
              className="h-full rounded-full"
              style={{ width: `${(s.count / max) * 100}%`, background: s.tone, opacity: 0.75 }}
            />
          </div>
          <span className="w-5 shrink-0 text-right font-mono text-xs text-text-muted">{s.count}</span>
        </div>
      ))}
    </div>
  )
}
