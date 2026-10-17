// The Case investigation engine's contract (docs/plans/2026-10-10-case-investigation-
// engine.md, E10). The exact check of a search field hit (retrieval plan D7) reports in
// the same vocabulary the engine's claim checks use.

export type TextCheck = 'present' | 'absent' | 'cannot-check'

export interface ClaimCheck {
  text: TextCheck
  basis: 'hash-verified' | 'unattested' | 'decoded' | null // null when the check could not run
  reason: string | null
}
