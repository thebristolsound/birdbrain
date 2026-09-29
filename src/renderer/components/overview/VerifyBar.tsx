import type { HashVerification } from '@shared/types'
import { getProvenanceColor } from '@renderer/components/captures/getProvenanceColor'

interface VerifyBarProps {
  verified: number
  unverified: number
  tampered: number
  chainBroken: number
  missing: number
}

type SegmentKey = keyof VerifyBarProps

interface Segment {
  key: SegmentKey
  label: string
  color: string
}

function badgeSegment(key: SegmentKey, status: HashVerification['status']): Segment {
  const { label, dot } = getProvenanceColor(status)
  return { key, label, color: dot }
}

// Each status takes the label and colour the capture's own views show, so a missing file or a
// broken chain reads the same here and never as Tampered. Unverified pools several statuses.
const SEGMENTS: Segment[] = [
  badgeSegment('verified', 'verified'),
  { key: 'unverified', label: 'Unverified', color: 'bg-amber-400' },
  badgeSegment('tampered', 'tampered'),
  badgeSegment('missing', 'missing'),
  badgeSegment('chainBroken', 'chain-broken')
]

export function VerifyBar({
  verified,
  unverified,
  tampered,
  chainBroken,
  missing
}: VerifyBarProps) {
  const counts = { verified, unverified, tampered, chainBroken, missing }
  const total = verified + unverified + tampered + chainBroken + missing

  if (total === 0) {
    return <p className="font-body text-xs text-text-faint">No captures to verify yet.</p>
  }

  return (
    <div>
      <div className="flex h-2 gap-0.5 overflow-hidden rounded-sm">
        {SEGMENTS.filter((s) => counts[s.key] > 0).map((s) => (
          <div
            key={s.key}
            title={`${s.label}: ${counts[s.key]}`}
            className={`${s.color} rounded-sm`}
            style={{ flexGrow: counts[s.key] }}
          />
        ))}
      </div>
      <div className="mt-2.5 flex flex-wrap gap-3.5">
        {SEGMENTS.map((s) => (
          <div
            key={s.key}
            data-testid={`verify-legend-${s.key}`}
            className="inline-flex items-center gap-1.5"
          >
            <span className={`h-[7px] w-[7px] rounded-full ${s.color}`} />
            <span className="text-[11px] tabular-nums text-text-secondary">{counts[s.key]}</span>
            <span className="font-body text-[11px] text-text-faint">{s.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
