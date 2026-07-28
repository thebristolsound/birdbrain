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
// The `seen` set exists only to stop the replay and the live listener from
// double-handling the same entry, so it needs to cover the replay window and a
// little slack — not the whole session. Unbounded, it grows for the lifetime of
// the renderer, and a component stuck in a retry loop is exactly the case that
// makes it grow fastest. Set preserves insertion order, so evicting from the
// front is FIFO.
const SEEN_LIMIT = 200

export function subscribeToMainLog(): () => void {
  const seen = new Set<string>()

  const remember = (id: string): void => {
    seen.add(id)
    while (seen.size > SEEN_LIMIT) {
      const oldest = seen.values().next()
      if (oldest.done) break
      seen.delete(oldest.value)
    }
  }

  const handle = (entry: LogEntry): void => {
    if (entry.source === 'renderer') return
    if (entry.level !== 'error' && entry.level !== 'warn') return
    if (seen.has(entry.id)) return
    remember(entry.id)

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
        if (history.length === 0) return
        // Scope the replay to THIS session. recentEntries reads the tail of the
        // log file, which spans launches, so an unfiltered replay greets the
        // tester with toasts for failures from a previous run — and their
        // "Report this" cites a correlation id from a session the bundle's log
        // may no longer even contain. The newest entry is always from the
        // current session, because app.session_start is written at every boot.
        const currentSession = history[0].sessionId
        for (const entry of [...history].reverse()) {
          if (entry.sessionId === currentSession) handle(entry)
        }
      })
      .catch(() => {
        // No replay is a degraded bridge, not a broken one.
      })
  } catch {
    // No replay is a degraded bridge, not a broken one.
  }

  return unsubscribe
}
