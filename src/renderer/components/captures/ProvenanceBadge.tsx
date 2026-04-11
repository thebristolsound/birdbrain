import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ShieldCheck, ShieldAlert, ShieldOff, Shield } from 'lucide-react'
import type { Capture, HashVerification } from '@shared/types'
import { queryKeys } from '@renderer/lib/queries'

interface Props {
  capture: Capture
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
    manifestIndex: capture.manifestIndex
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

  if (result.status === 'verified') {
    return (
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
  }
  if (result.status === 'legacy') {
    return (
      <button
        onClick={() => verifyMutation.mutate()}
        disabled={loading}
        className="flex items-center gap-1 rounded-lg bg-amber-500/10 px-2 py-1 text-[11px] text-amber-400 hover:bg-amber-500/20 disabled:opacity-50"
      >
        <Shield className="h-3 w-3" />
        Legacy HTML
      </button>
    )
  }
  if (result.status === 'tampered' || result.status === 'chain-broken') {
    return (
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
  }
  return (
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
