// The one rule for reading a capture's recorded HTTP status (R7, #797).
//
// The column is `0` whenever no status reached the capture server — the wire
// schema coerces a missing `httpStatus` field to 0 — and a capture of a
// `birdbrain://` URL never had an HTTP transaction at all. Nothing else in the
// record distinguishes "the origin answered 0" (impossible) from "no status was
// recorded", so 0 and any value outside the status range mean unrecorded.
//
// report.html, the per-capture PDF cover and the manifest entry writer all read
// the status through this function, so for a capture ingested by this build or
// later the status the report prints and the status the chain attests are the
// same derivation.
//
// That equality does NOT reach backwards, and the difference matters in court.
// Until R7 the extension sent a hard-coded `httpStatus: 200` on every capture
// request whatever the origin returned, and the manifest entry had no
// `httpStatus` key at all. So a pre-R7 row holds a fabricated 200 that this
// function happily returns, and its report prints `HTTP status 200` against a
// signed entry that says nothing about the status —
// tests/shared/verify/fixtures/pre-scope-package is exactly such a package.
// Anyone explaining a status to a reader has to know which side of R7 the
// capture falls on; the entry is the only side the chain covers.
//
// Two in-app rails (ForensicsTab, DataExplorer) still read `capture.httpStatus`
// off the row without this function. Their truthiness tests drop a 0, which is
// the only value this build can write that they would otherwise misreport.
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
