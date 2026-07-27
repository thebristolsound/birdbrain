import { toast } from 'sonner'
import type { LogEntry } from '@shared/types'
import { labelForCode } from '@renderer/lib/notify'

// Main already wrote these to disk, so this path toasts ONLY — routing them
// back through notify.error would write a duplicate entry and, because that
// write emits again, risk a feedback loop.
//
// The 'renderer' filter is load-bearing. A renderer notify.error() travels to
// main over diagnostics:log, gets written, and is emitted straight back out
// over event:logEntry. Without this guard every renderer failure raises two
// toasts with different ids, so dedup cannot collapse them.
//
// Equality, not startsWith. LOG_SOURCES is a closed union with a plain
// 'renderer' member and no `renderer:*` prefix convention — see its comment in
// @shared/types. A prefix test would additionally imply that some other source
// could legitimately begin with 'renderer', which the union does not allow.
export function subscribeToMainLog(): () => void {
  const seen = new Set<string>()

  const handle = (entry: LogEntry): void => {
    if (entry.source === 'renderer') return
    if (entry.level !== 'error' && entry.level !== 'warn') return
    if (seen.has(entry.id)) return
    seen.add(entry.id)

    // Two different ids do two different jobs here, and conflating them was a
    // bug: entry.id is unique PER ENTRY, so using it as the sonner id gives a
    // retry loop or a failing capture batch one toast per occurrence and
    // buries the UI — exactly the storm that notify's dedup exists to prevent.
    // The sonner id must be stable per failure KIND; the correlation id must
    // be the newest actual entry, so Report this cites something real.
    const opts = {
      id: `m:${entry.source}:${entry.code}`,
      action: {
        label: 'Report this',
        onClick: () =>
          window.dispatchEvent(
            new CustomEvent('birdbrain:report', { detail: { correlationId: entry.id } })
          )
      }
    }

    // Codes are not prose — labelForCode maps them to a readable sentence for
    // display only. The durable entry keeps the code.
    const text = labelForCode(entry.code)
    if (entry.level === 'error') toast.error(text, opts)
    else toast.warning(text, opts)
  }

  const unsubscribe = window.birdbrain.onLogEntry(handle)

  // onLogEntry is a one-shot event with no replay. Between setLoggerWindow()
  // and this subscription mounting — on first load, on reload, and on macOS
  // window recreation — main-process entries are written durably but their
  // event is lost, so an early updater, storage or capture failure produced no
  // toast at all. Replaying the current session's tail closes that window.
  // Ordered oldest-first so the newest failure ends up as the surviving toast
  // under each deduped id, and filtered through the same `seen` set so an
  // entry present in both paths is handled once.
  try {
    void window.birdbrain.diagnostics
      .recentEntries(50)
      .then((history) => {
        for (const entry of [...history].reverse()) handle(entry)
      })
      .catch(() => {
        // No replay is a degraded bridge, not a broken one.
      })
  } catch {
    // No replay is a degraded bridge, not a broken one.
  }

  return unsubscribe
}
