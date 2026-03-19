interface TimelineEntry {
  observation: string
  significance: string
}

interface EntityTimelineProps {
  entries: TimelineEntry[]
}

const DOT_STYLES = [
  'bg-indigo-400 shadow-[0_0_8px_rgba(129,140,248,0.4)]',
  'bg-purple-400 shadow-[0_0_6px_rgba(167,139,250,0.3)]',
  'bg-indigo-500 shadow-[0_0_6px_rgba(99,102,241,0.3)]'
]

const DATE_STYLES = [
  'text-indigo-400',
  'text-purple-400',
  'text-indigo-500'
]

export function EntityTimeline({ entries }: EntityTimelineProps) {
  if (entries.length === 0) return null

  return (
    <div className="space-y-3">
      {entries.map((entry, i) => {
        const dotStyle = DOT_STYLES[i % DOT_STYLES.length]
        const dateStyle = DATE_STYLES[i % DATE_STYLES.length]
        const isLast = i === entries.length - 1
        return (
          <div key={i} className="flex gap-3">
            <div className="flex flex-col items-center">
              <div className={`mt-1.5 h-2 w-2 rounded-full ${dotStyle}`} />
              {!isLast && <div className="w-px flex-1 bg-indigo-400/20" />}
            </div>
            <div className={isLast ? '' : 'pb-3'}>
              <span className={`font-mono text-[10px] font-medium ${dateStyle}`}>
                {entry.significance}
              </span>
              <p className="mt-1 text-[11px] leading-relaxed text-slate-300">
                {entry.observation}
              </p>
            </div>
          </div>
        )
      })}
    </div>
  )
}
