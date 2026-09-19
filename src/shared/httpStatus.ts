// The one rule for reading a capture's recorded HTTP status (R7, #797).
//
// The column is `0` whenever no status reached the capture server — the wire
// schema coerces a missing `httpStatus` field to 0 — and a capture of a
// `birdbrain://` URL never had an HTTP transaction at all. Nothing else in the
// record distinguishes "the origin answered 0" (impossible) from "no status was
// recorded", so 0 and any value outside the status range mean unrecorded.
//
// Both operator-facing artifacts (report.html, the per-capture PDF cover) and
// the manifest entry writer read the status through this function, so the code
// the chain attests to and the code the report prints are the same derivation:
// a reader can never be shown a status the signed entry omits.
//
// The range is HTTP semantics' own (RFC 9110 §15: a status code is three
// digits, 1xx-5xx). A value outside it is not a status, so it is neither
// displayed nor anchored.
const MIN_HTTP_STATUS = 100
const MAX_HTTP_STATUS = 599

export function recordedHttpStatus(status: number | null | undefined): number | undefined {
  if (typeof status !== 'number' || !Number.isInteger(status)) return undefined
  if (status < MIN_HTTP_STATUS || status > MAX_HTTP_STATUS) return undefined
  return status
}
