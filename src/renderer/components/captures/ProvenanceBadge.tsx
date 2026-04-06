import { useEffect, useState } from 'react'
import { ShieldCheck, ShieldAlert, ShieldOff, Shield } from 'lucide-react'
import type { HashVerification } from '@shared/types'

interface Props {
  captureId: string
}

export function ProvenanceBadge({ captureId }: Props) {
  const [result, setResult] = useState<HashVerification | null>(null)
  const [loading, setLoading] = useState(false)

  async function verify() {
    setLoading(true)
    try {
      const r = await window.birdbrain.captures.verify(captureId)
      setResult(r)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    setResult(null)
  }, [captureId])

  if (!result) {
    return (
      <button
        onClick={verify}
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
      <span className="flex items-center gap-1 rounded-lg bg-emerald-500/10 px-2 py-1 text-[11px] text-emerald-400">
        <ShieldCheck className="h-3 w-3" />
        Verified {result.manifestIndex !== undefined ? '#' + result.manifestIndex : ''}
      </span>
    )
  }
  if (result.status === 'legacy') {
    return (
      <span className="flex items-center gap-1 rounded-lg bg-amber-500/10 px-2 py-1 text-[11px] text-amber-400">
        <Shield className="h-3 w-3" />
        Legacy HTML
      </span>
    )
  }
  if (result.status === 'tampered' || result.status === 'chain-broken') {
    return (
      <span
        title={result.reason}
        className="flex items-center gap-1 rounded-lg bg-red-500/10 px-2 py-1 text-[11px] text-red-400"
      >
        <ShieldAlert className="h-3 w-3" />
        {result.status === 'tampered' ? 'Tampered' : 'Chain broken'}
      </span>
    )
  }
  return (
    <span className="flex items-center gap-1 rounded-lg bg-gray-500/10 px-2 py-1 text-[11px] text-gray-400">
      <ShieldOff className="h-3 w-3" />
      {result.status}
    </span>
  )
}
