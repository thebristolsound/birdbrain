import type { Capture } from '@shared/types'

const THUMB_COLORS = [
  { from: 'rgba(49,46,129,0.3)', to: 'rgba(30,27,75,0.2)', bar: 'rgba(129,140,248,0.25)' },
  { from: 'rgba(6,78,59,0.3)', to: 'rgba(4,47,36,0.2)', bar: 'rgba(52,211,153,0.25)' },
  { from: 'rgba(124,45,18,0.25)', to: 'rgba(67,20,7,0.15)', bar: 'rgba(251,146,60,0.25)' },
  { from: 'rgba(12,74,110,0.25)', to: 'rgba(7,47,75,0.15)', bar: 'rgba(56,189,248,0.25)' },
  { from: 'rgba(76,29,149,0.25)', to: 'rgba(46,16,101,0.15)', bar: 'rgba(167,139,250,0.25)' },
  { from: 'rgba(136,19,55,0.25)', to: 'rgba(76,5,25,0.15)', bar: 'rgba(251,113,133,0.25)' },
  { from: 'rgba(19,78,74,0.25)', to: 'rgba(4,47,46,0.15)', bar: 'rgba(45,212,191,0.25)' },
  { from: 'rgba(51,65,85,1)', to: 'rgba(30,41,59,1)', bar: 'rgba(100,116,139,0.3)' }
]

function getThumbColor(url: string) {
  let hash = 0
  for (let i = 0; i < url.length; i++) {
    hash = ((hash << 5) - hash + url.charCodeAt(i)) | 0
  }
  return THUMB_COLORS[Math.abs(hash) % THUMB_COLORS.length]
}

function formatTimestamp(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins} min ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} hour${hours !== 1 ? 's' : ''} ago`
  return new Date(ts).toLocaleDateString()
}

interface CaptureItemProps {
  capture: Capture
  isSelected: boolean
  onClick: () => void
}

export function CaptureItem({ capture, isSelected, onClick }: CaptureItemProps) {
  let hostname = ''
  try {
    hostname = new URL(capture.url).hostname
  } catch {
    hostname = capture.url
  }

  const color = getThumbColor(capture.url)

  return (
    <button
      onClick={onClick}
      className={`w-full rounded-xl border p-2 text-left transition-colors ${
        isSelected
          ? 'border-indigo-500/35 bg-indigo-500/15'
          : 'border-transparent hover:bg-white/[0.04]'
      }`}
    >
      <div className="flex gap-2">
        {/* Thumbnail */}
        <div
          className="h-12 w-16 shrink-0 rounded-lg overflow-hidden flex flex-col justify-center gap-1 px-1.5"
          style={{
            background: `linear-gradient(to bottom right, ${color.from}, ${color.to})`
          }}
        >
          <div className="h-1 w-full rounded-full" style={{ backgroundColor: color.bar }} />
          <div
            className="h-1 w-3/4 rounded-full"
            style={{ backgroundColor: color.bar, opacity: 0.7 }}
          />
          <div
            className="h-1 w-1/2 rounded-full"
            style={{ backgroundColor: color.bar, opacity: 0.5 }}
          />
        </div>
        {/* Text */}
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-slate-200">
            {capture.title || hostname}
          </div>
          <div className="mt-0.5 truncate font-mono text-[11px] text-slate-500">{hostname}</div>
          <div className="mt-0.5 text-[11px] text-slate-600">
            {formatTimestamp(capture.timestamp)}
          </div>
        </div>
      </div>
    </button>
  )
}
