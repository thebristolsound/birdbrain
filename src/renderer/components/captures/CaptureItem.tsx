import type { Capture } from '@shared/types'

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

  return (
    <button
      onClick={onClick}
      className={`w-full px-3 py-2 text-left ${
        isSelected
          ? 'bg-neutral-800 text-neutral-100'
          : 'text-neutral-400 hover:bg-neutral-800/50 hover:text-neutral-200'
      }`}
    >
      <div className="truncate text-sm">{capture.title || hostname}</div>
      <div className="mt-0.5 flex items-center gap-2">
        <span className="truncate font-mono text-xs text-neutral-600">{hostname}</span>
        <span className="shrink-0 text-xs text-neutral-600">
          {new Date(capture.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
    </button>
  )
}
