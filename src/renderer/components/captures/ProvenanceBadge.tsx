import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ShieldCheck, ShieldAlert, ShieldOff, Shield, Clock, Stamp } from 'lucide-react'
import type { Capture, HashVerification } from '@shared/types'
import { queryKeys } from '@renderer/lib/queries'

interface Props {
  capture: Capture
}

// The trusted-time axis (#120), rendered as a separate chip beside the integrity
// badge so the two axes read independently. 'none' renders nothing — a capture
// that was never eligible for timestamping shouldn't show a noisy placeholder.
function TrustedTimeChip({ result }: { result: HashVerification }) {
  if (result.trustedTime === 'rfc3161') {
    const detail = [result.tsaName, result.stampedAt && new Date(result.stampedAt).toLocaleString()]
      .filter(Boolean)
      .join(' — ')
    return (
      <span
        title={detail || 'RFC 3161 trusted timestamp'}
        className="flex items-center gap-1 rounded-lg bg-emerald-500/10 px-2 py-1 text-[11px] text-emerald-400"
      >
        <Stamp className="h-3 w-3" />
        Timestamped
      </span>
    )
  }
  if (result.trustedTime === 'pending') {
    return (
      <span
        title="Awaiting a trusted timestamp from the TSA"
        className="flex items-center gap-1 rounded-lg bg-amber-500/10 px-2 py-1 text-[11px] text-amber-400"
      >
        <Clock className="h-3 w-3" />
        Timestamp pending
      </span>
    )
  }
  return null
}

// Hydrates a HashVerification shape from the persisted last_verified_* columns
// on the Capture row. This is what lets the badge "stick" across remounts — the
// verification lives in SQLite, not just component state.
function hydrateFromCapture(capture: Capture): HashVerification | null {
  if (!capture.lastVerifiedStatus) return null
  return {
    captureId: capture.id,
    url: capture.url,
    title: capture.title,
    storedHash: capture.hash,
    computedHash: capture.lastVerifiedHash ?? '',
    status: capture.lastVerifiedStatus,
    manifestIndex: capture.manifestIndex,
    trustedTime: capture.trustedTimeStatus ?? 'none'
  }
}

export function ProvenanceBadge({ capture }: Props) {
  const queryClient = useQueryClient()

  const verifyMutation = useMutation({
    mutationFn: () => window.birdbrain.captures.verify(capture.id),
    onSuccess: () => {
      // Re-fetch the captures list so the persisted last_verified_* columns flow
      // back into this component (and any other consumer) on the next render.
      queryClient.invalidateQueries({ queryKey: queryKeys.captures(capture.caseId) })
    }
  })

  // Prefer the fresh mutation result when we have one; otherwise rehydrate from
  // the DB-backed fields on the capture row.
  const result = verifyMutation.data ?? hydrateFromCapture(capture)
  const loading = verifyMutation.isPending

  if (!result) {
    return (
      <button
        onClick={() => verifyMutation.mutate()}
        disabled={loading}
        className="flex items-center gap-1 rounded-lg bg-surface px-2 py-1 text-[11px] text-text-muted hover:bg-elevated disabled:opacity-50"
      >
        <Shield className="h-3 w-3" />
        {loading ? 'Verifying...' : 'Verify'}
      </button>
    )
  }

  // Integrity axis (left chip). The trusted-time axis is rendered as a sibling
  // chip so the two read as independent columns.
  let integrity
  if (result.status === 'verified') {
    integrity = (
      <button
        onClick={() => verifyMutation.mutate()}
        disabled={loading}
        title="Re-verify capture integrity"
        className="flex items-center gap-1 rounded-lg bg-emerald-500/10 px-2 py-1 text-[11px] text-emerald-400 hover:bg-emerald-500/20 disabled:opacity-50"
      >
        <ShieldCheck className="h-3 w-3" />
        {loading
          ? 'Verifying...'
          : 'Verified' + (result.manifestIndex !== undefined ? ' #' + result.manifestIndex : '')}
      </button>
    )
  } else if (result.status === 'legacy') {
    integrity = (
      <button
        onClick={() => verifyMutation.mutate()}
        disabled={loading}
        className="flex items-center gap-1 rounded-lg bg-amber-500/10 px-2 py-1 text-[11px] text-amber-400 hover:bg-amber-500/20 disabled:opacity-50"
      >
        <Shield className="h-3 w-3" />
        Legacy HTML
      </button>
    )
  } else if (result.status === 'tampered' || result.status === 'chain-broken') {
    integrity = (
      <button
        onClick={() => verifyMutation.mutate()}
        disabled={loading}
        title={result.reason}
        className="flex items-center gap-1 rounded-lg bg-red-500/10 px-2 py-1 text-[11px] text-red-400 hover:bg-red-500/20 disabled:opacity-50"
      >
        <ShieldAlert className="h-3 w-3" />
        {result.status === 'tampered' ? 'Tampered' : 'Chain broken'}
      </button>
    )
  } else {
    integrity = (
      <button
        onClick={() => verifyMutation.mutate()}
        disabled={loading}
        className="flex items-center gap-1 rounded-lg bg-gray-500/10 px-2 py-1 text-[11px] text-gray-400 hover:bg-gray-500/20 disabled:opacity-50"
      >
        <ShieldOff className="h-3 w-3" />
        {result.status}
      </button>
    )
  }

  return (
    <div className="flex items-center gap-1.5">
      {integrity}
      <TrustedTimeChip result={result} />
    </div>
  )
}
