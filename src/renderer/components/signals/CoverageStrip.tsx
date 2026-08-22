import type { Capture } from '@shared/types'

interface CoverageStripProps {
  /** The recent captures, newest first — one cell each. */
  captures: Capture[]
  /** Which of those this signal covers. */
  captureIds: string[]
  /** Fill for a covered cell: the tag's own colour, or the accent. */
  fill: string
  label: string
}

// One cell per recent capture, filled where the signal covers it. Read as a
// shape, not as data: the point is whether a selector fires across the case or
// only at one end of it.
export function CoverageStrip({ captures, captureIds, fill, label }: CoverageStripProps) {
  const covered = new Set(captureIds)

  return (
    <div
      className="flex shrink-0 gap-[3px]"
      role="img"
      aria-label={`${label}: ${captureIds.length} of ${captures.length} recent captures`}
      data-testid="coverage-strip"
    >
      {captures.map((capture) => (
        <span
          key={capture.id}
          // The capture's own title, so hovering a cell answers "which page?"
          // without leaving the screen.
          title={capture.title || capture.url}
          data-covered={covered.has(capture.id) ? 'true' : 'false'}
          className="h-[10px] w-[10px] rounded-[2px]"
          style={{
            background: covered.has(capture.id)
              ? fill
              : 'color-mix(in srgb, var(--color-text-primary) 9%, transparent)'
          }}
        />
      ))}
    </div>
  )
}
