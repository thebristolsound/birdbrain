import type { TrustedTime } from '@shared/types'

// Structural subset of TrustedTimeResult (src/shared/verify/trustedTime.ts).
// Not imported from there: the renderer tsconfig excludes src/shared/verify,
// and this module has to compile in every project that can reach @shared/*.
export interface TrustedTimeDisclosureInput {
  trustedTime: TrustedTime
  tsaName?: string
}

// The one home for the trusted-time axis vocabulary that reaches operator-facing
// artifacts (report.html and the per-capture PDF cover). Both render the axis
// from these strings so the same capture is never labelled 'Local clock only'
// in one artifact and 'Local clock — token pending' in the other. Each artifact
// still phrases its own trailing explanation; only the leading label and the
// two token-fallback phrases are shared.
export const TRUSTED_TIME_LABELS: Readonly<Record<TrustedTime, string>> = {
  rfc3161: 'RFC 3161 token retained',
  pending: 'Local clock — token pending',
  none: 'Local clock only'
}

// A retained token need not name its issuer, and when it does not the issuer is
// not knowable from the token: an imported archive was stamped by whatever
// authority the originating operator used, and re-pointing the TSA setting must
// not retroactively rename the party that signed earlier tokens. So the fallback
// says the identity is unrecorded rather than naming this install's configured
// authority.
export const TRUSTED_TIME_UNNAMED_TSA =
  'an RFC 3161 authority whose identity is not recorded in the retained token'

export const TRUSTED_TIME_UNRECORDED_STAMPED_AT = 'the time recorded in the retained token'

// What report.html and certification.html print in the "Time-stamping authority
// (configured)" field when the installation has declined trusted timestamping
// (#1169). Printing the endpoint there instead would have the document name a
// third party the operator refused to contact, beside a process paragraph that
// describes hashes being submitted to one.
//
// Worded as a statement about the installation's configuration at generation
// time, and nothing more. A package can hold tokens obtained before the operator
// switched timestamping off, so any claim here about what was or was not
// submitted would be false for that package; the per-exhibit rows carry that.
export const TRUSTED_TIME_AUTHORITY_DECLINED =
  'None — trusted timestamping is switched off for this installation'

export function trustedTimeLabel(resolved: TrustedTimeDisclosureInput): string {
  return TRUSTED_TIME_LABELS[resolved.trustedTime] ?? TRUSTED_TIME_LABELS.none
}

// The party a stamped capture's disclosure attributes the assertion to.
export function trustedTimeAttestingParty(resolved: TrustedTimeDisclosureInput): string {
  return resolved.tsaName ?? TRUSTED_TIME_UNNAMED_TSA
}
