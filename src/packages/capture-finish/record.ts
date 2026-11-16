// Entry point: a Capture Method's recording in, the Transaction Record with its inventory part
// and Bound TLS Details (plan D7) out, or the record absent as `failed`. lib/ is private.
export { boundTlsOf, finishRecord } from './lib/record'
export type { PresentRecord, RecordOutcome, Recording } from './lib/record'
