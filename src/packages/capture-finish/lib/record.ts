import { writeTransactionRecord } from '../../transaction-record/writer'
import type { WriterInput, WrittenTransactionRecord } from '../../transaction-record/writer'
import type { CollectedExchanges, Exchange } from '../../transaction-record/collector'
import { BoundTlsSchema, CaptureInventorySchema } from '@shared/schemas'
import type { BoundTls, CaptureInventory } from '@shared/schemas'
import { CREDENTIAL_HEADER_NAMES } from '@shared/types'
import type { BoundTlsAbsence, CredentialHeaderName } from '@shared/types'

type RecordPart = CaptureInventory['transactionRecord']

export type PresentRecordPart = Extract<RecordPart, { present: true }>

/**
 * What only some Capture Methods sign about a record: the exchanges a service worker served, the
 * request bodies withheld (ADR-0051), and that the HTTP cache was disabled. A method states each
 * one or leaves its key out; the finish adds none of its own.
 */
export type MethodRecordFacts = Pick<
  PresentRecordPart,
  'servedByServiceWorker' | 'requestBodiesWithheld' | 'httpCacheDisabled'
>

/** A Capture Method's recording, once nothing more is recorded into it. */
export interface Recording {
  /**
   * Waits for the body fetches still out, under the method's own bound, then collects. Rejects
   * with the method's own error when the bound runs out or the recording overflowed. Returns the
   * collector's counts as they are, with the method's facts.
   */
  collect(): Promise<CollectedExchanges & { methodFacts: MethodRecordFacts }>
  /**
   * Holds the writer, which is already running, to the method's own bound: settles as `writing`
   * does, or rejects with the method's own error. It never starts or retries the writer.
   */
  boundWrite<T>(writing: Promise<T>): Promise<T>
  writer: Omit<WriterInput, 'exchanges'>
  /**
   * The URL the saved page's document committed at, which `boundTlsOf` compares; undefined when
   * the saved page came from no recorded request.
   */
  committedUrl: string | undefined
  /** The limits the recording held its bodies under, which the inventory states. */
  budget: { totalBytes: number; resourceBytes: number }
  /** The writer, for a test to stand in. */
  write?: (input: WriterInput) => Promise<WrittenTransactionRecord>
}

export interface PresentRecord {
  present: true
  warcGz: Buffer
  inventory: PresentRecordPart
  boundTls?: BoundTls
  boundTlsAbsent?: Exclude<BoundTlsAbsence, 'not-recorded'>
}

export type FinishedRecord = PresentRecord | { present: false; reason: 'failed'; error: unknown }

/**
 * The Transaction Record of one Capture, or why it carries none. A method whose recording does
 * not cover the page states the absence itself; Bound TLS Details are then `not-recorded` (D7).
 */
export type RecordOutcome =
  | PresentRecord
  | { present: false; reason: Extract<RecordPart, { present: false }>['reason']; error?: unknown }

// A document's URL without its fragment, which CDP leaves out of a request's URL; undefined when
// it does not parse.
const documentUrl = (url: string): URL | undefined => {
  try {
    const parsed = new URL(url)
    parsed.hash = ''
    return parsed
  } catch {
    return undefined
  }
}

// D7: why the entry carries no Bound TLS Details, or the details of the main document.
// `committedUrl` is the URL of the page's last cross-document navigation at the save. A
// navigation that sends no request, such as going back to the blank page a hidden window loads
// first or opening `about:blank`, leaves the main document on the earlier page, so its details are
// signed only when that page is the one saved (ruling of 2026-10-29 on #1999). It is undefined
// when the saved page came from no recorded request.
export function boundTlsOf(
  mainDocument: Exchange | undefined,
  committedUrl: string | undefined
): { boundTls: BoundTls } | { boundTlsAbsent: Exclude<BoundTlsAbsence, 'not-recorded'> } {
  if (mainDocument === undefined) return { boundTlsAbsent: 'not-reported' }
  const { response, request, state } = mainDocument
  const url = documentUrl(response?.url ?? request.url)
  const committed = committedUrl === undefined ? undefined : documentUrl(committedUrl)
  if (url === undefined || committed === undefined || url.href !== committed.href) {
    return { boundTlsAbsent: 'not-reported' }
  }
  if (url.protocol === 'http:') return { boundTlsAbsent: 'not-https' }
  if (state === 'cached') return { boundTlsAbsent: 'from-cache' }
  return response?.securityDetails
    ? { boundTls: response.securityDetails }
    : { boundTlsAbsent: 'not-reported' }
}

const CREDENTIAL_NAMES = new Set<string>(CREDENTIAL_HEADER_NAMES)
const isCredentialName = (name: string): name is CredentialHeaderName => CREDENTIAL_NAMES.has(name)

// The strict shape the verifier reads for the inventory part, so a value it refuses fails this
// record rather than reaching the signed entry, where it would break the Case's chain.
const TransactionRecordPartSchema = CaptureInventorySchema.shape.transactionRecord

/**
 * The end phases of a Transaction Record: the collection, the writer, the inventory part, then
 * Bound TLS Details. Never throws. A phase that fails or outlasts the method's bound, or a field
 * the strict schema refuses, records the Transaction Record absent as `failed` with the error as
 * it was thrown, and the Capture still stores (open question E).
 */
export async function finishRecord({
  collect,
  boundWrite,
  writer,
  committedUrl,
  budget,
  write = writeTransactionRecord
}: Recording): Promise<FinishedRecord> {
  try {
    const { exchanges, counts, mainDocument, methodFacts } = await collect()
    const { bytes, replacedHeaders } = await boundWrite(write({ ...writer, exchanges }))
    // A part that says `present: true` parses only as the present variant.
    const inventory = TransactionRecordPartSchema.parse({
      present: true,
      exchanges: counts.exchanges,
      cached: counts.cached,
      cancelled: counts.cancelled,
      failed: counts.failed,
      inFlight: counts.inFlight,
      finishedWithoutResponse: counts.finishedWithoutResponse,
      bodiesOmitted: counts.bodiesOmitted,
      incompleteRequestBodies: counts.incompleteRequestBodies,
      webSockets: counts.webSockets,
      recordedTargets: counts.recordedTargets,
      unrecordedTargets: counts.unrecordedTargets,
      replacedHeaders: replacedHeaders.filter(isCredentialName),
      budget: { totalBytes: budget.totalBytes, resourceBytes: budget.resourceBytes },
      ...methodFacts
    }) as PresentRecordPart
    const bound = boundTlsOf(mainDocument, committedUrl)
    return {
      present: true,
      warcGz: Buffer.from(bytes),
      inventory,
      ...('boundTls' in bound ? { boundTls: BoundTlsSchema.parse(bound.boundTls) } : bound)
    }
  } catch (error) {
    return { present: false, reason: 'failed', error }
  }
}
