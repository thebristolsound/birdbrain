import type { HashVerification } from '@shared/types'

export type ProvenanceStatus = HashVerification['status'] | undefined

interface ProvenanceColorTokens {
  text: string
  bg: string
  dot: string
  label: string
}

/**
 * Maps a verification status to Tailwind color tokens for the shield, dot, and
 * background. Status palette is intentionally raw (red/amber/emerald) — these
 * convey forensic state and don't theme-swap per `theme.md`.
 */
export function getProvenanceColor(status: ProvenanceStatus): ProvenanceColorTokens {
  switch (status) {
    case 'verified':
      return {
        text: 'text-emerald-400',
        bg: 'bg-emerald-500/10',
        dot: 'bg-emerald-400',
        label: 'Verified'
      }
    case 'tampered':
      return {
        text: 'text-red-400',
        bg: 'bg-red-500/10',
        dot: 'bg-red-400',
        label: 'Changed since capture'
      }
    case 'chain-broken':
      return {
        text: 'text-red-400',
        bg: 'bg-red-500/10',
        dot: 'bg-red-400',
        label: 'Chain broken'
      }
    case 'missing':
      return {
        text: 'text-amber-400',
        bg: 'bg-amber-500/10',
        dot: 'bg-amber-400',
        label: 'Missing'
      }
    case 'legacy':
      return {
        text: 'text-amber-400',
        bg: 'bg-amber-500/10',
        dot: 'bg-amber-400',
        label: 'Legacy HTML'
      }
    // Not verified and not tampered (X25). Worded as the CLI's "VERIFIER TOO
    // OLD" and coloured as the chain ledger colours the same outcome.
    case 'verifier-too-old':
      return {
        text: 'text-warning-fg',
        bg: 'bg-warning-surface',
        dot: 'bg-warning-fg',
        label: 'Verifier too old'
      }
    default:
      return {
        text: 'text-text-faint',
        bg: 'bg-surface',
        dot: 'bg-text-faint',
        label: 'Not verified'
      }
  }
}
