interface ActivityDay {
  count: number
  fresh: boolean
}

interface ActivityTimelineProps {
  days: ActivityDay[]
  rangeDays: number
}

export function ActivityTimeline({ days, rangeDays }: ActivityTimelineProps) {
  const max = Math.max(1, ...days.map((d) => d.count))
  return (
    <div>
      <div className="flex h-[92px] items-end gap-1.5">
        {days.map((d, i) => (
          <div key={i} className="flex h-full flex-1 flex-col justify-end">
            <div
              className={`min-h-[4px] rounded-md ${d.fresh ? 'bg-accent' : 'bg-accent/30'}`}
              style={{ height: `${Math.max(6, (d.count / max) * 100)}%` }}
              title={`${d.count} ${d.count === 1 ? 'capture' : 'captures'}`}
            />
          </div>
        ))}
      </div>
      <div className="mt-2 flex justify-between">
        <span className="font-mono text-[10px] text-text-faint">{rangeDays}d ago</span>
        <span className="font-mono text-[10px] text-text-faint">Today</span>
      </div>
    </div>
  )
}
