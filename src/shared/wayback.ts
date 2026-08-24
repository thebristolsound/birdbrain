// Wording shared by every surface that shows a pinned or looked-up archive.org
// snapshot beside the capture it corroborates: the Wayback panel, the export
// dialog and the exhibit's corroboration block in report.html.
//
// The interval is the whole point of the phrasing. A snapshot taken a year before
// the capture corroborates something different from one taken an hour after it, and
// the reader is the one who has to weigh that — so the direction is always stated in
// words rather than left to a signed number.

/** Milliseconds from the capture to the snapshot; negative means before. */
export function snapshotDeltaMs(snapshotIso: string, captureIso: string): number | null {
  const snapshot = Date.parse(snapshotIso)
  const capture = Date.parse(captureIso)
  if (Number.isNaN(snapshot) || Number.isNaN(capture)) return null
  return snapshot - capture
}

/**
 * `2d 3h after capture` / `45m before capture`, or null when either timestamp is
 * unparseable — a caller with no interval to state should say nothing rather than
 * print a delta it cannot compute.
 */
export function formatSnapshotDelta(snapshotIso: string, captureIso: string): string | null {
  const deltaMs = snapshotDeltaMs(snapshotIso, captureIso)
  if (deltaMs === null) return null
  const direction = deltaMs < 0 ? 'before capture' : 'after capture'
  // Rounded once, to minutes, then carried up. Rounding each unit separately
  // produces "23h 60m" at the boundaries.
  const totalMinutes = Math.round(Math.abs(deltaMs) / 60_000)
  if (totalMinutes < 60) return `${totalMinutes}m ${direction}`
  const totalHours = Math.floor(totalMinutes / 60)
  const restMinutes = totalMinutes % 60
  if (totalHours < 24) {
    return `${totalHours}h ${restMinutes ? `${restMinutes}m ` : ''}${direction}`
  }
  const days = Math.floor(totalHours / 24)
  const restHours = totalHours % 24
  return `${days}d ${restHours ? `${restHours}h ` : ''}${direction}`
}
