interface VerifyBarProps {
  verified: number
  unverified: number
  tampered: number
}

const SEGMENTS = [
  { key: 'verified', label: 'Verified', color: 'bg-emerald-400' },
  { key: 'unverified', label: 'Unverified', color: 'bg-amber-400' },
  { key: 'tampered', label: 'Tampered', color: 'bg-red-400' }
] as const

export function VerifyBar({ verified, unverified, tampered }: VerifyBarProps) {
  const counts = { verified, unverified, tampered }
  const total = verified + unverified + tampered

  if (total === 0) {
    return <p className="font-body text-xs text-text-faint">No captures to verify yet.</p>
  }

  return (
    <div>
      <div className="flex h-2 gap-0.5 overflow-hidden rounded-full">
        {SEGMENTS.filter((s) => counts[s.key] > 0).map((s) => (
          <div
            key={s.key}
            title={`${s.label}: ${counts[s.key]}`}
            className={`${s.color} rounded-full`}
            style={{ flexGrow: counts[s.key] }}
          />
        ))}
      </div>
      <div className="mt-2.5 flex flex-wrap gap-3.5">
        {SEGMENTS.map((s) => (
          <div key={s.key} className="inline-flex items-center gap-1.5">
            <span className={`h-[7px] w-[7px] rounded-full ${s.color}`} />
            <span className="font-mono text-[11.5px] text-text-secondary">{counts[s.key]}</span>
            <span className="font-body text-[11.5px] text-text-faint">{s.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
