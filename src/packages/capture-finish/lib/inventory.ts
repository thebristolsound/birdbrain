import type { BoundTls, CaptureInventory } from '@shared/schemas'
import type { BoundTlsAbsence } from '@shared/types'
import type { PdfOutcome } from './pdf'
import type { RecordOutcome } from './record'

// What a Capture Method knows about the screenshot it took: the inventory's screenshot part
// without `present` (D6 of docs/plans/2026-10-10-capture-engine-first-slice.md).
export type ScreenshotRecord = Omit<CaptureInventory['screenshot'], 'present'>

// The inventory's MHTML part, with the Image Source Pinning counts (ADR-0055).
export type ImageSourcePinning = CaptureInventory['mhtml']

export interface FinishedParts {
  /** The Image Source Pinning counts the method read, or the zeros of a method that pins none. */
  mhtml: ImageSourcePinning
  screenshot: ScreenshotRecord
  transactionRecord: RecordOutcome
  pdf: PdfOutcome
}

/** What the ingest takes from a finished Capture. A key is present only when its value is. */
export interface FinishFields {
  inventory: CaptureInventory
  transactionRecord?: Buffer
  boundTls?: BoundTls
  boundTlsAbsent?: BoundTlsAbsence
  pdf?: Buffer
}

/**
 * The inventory a Capture signs (D4 of docs/plans/2026-10-10-capture-engine-first-slice.md), with
 * the Transaction Record, Bound TLS Details or why they are absent (D7), and the PDF. Every part
 * is signed as the method supplied it; a Capture with no record has its Bound TLS Details
 * `not-recorded`.
 */
export function finishFields({
  mhtml,
  screenshot,
  transactionRecord,
  pdf
}: FinishedParts): FinishFields {
  const { boundTls, boundTlsAbsent } = transactionRecord.present
    ? transactionRecord
    : { boundTls: undefined, boundTlsAbsent: 'not-recorded' as const }
  return {
    inventory: {
      mhtml,
      transactionRecord: transactionRecord.present
        ? transactionRecord.inventory
        : { present: false, reason: transactionRecord.reason },
      screenshot: { present: true, ...screenshot },
      pdf: pdf.present ? pdf.inventory : { present: false, reason: pdf.reason }
    },
    ...(transactionRecord.present ? { transactionRecord: transactionRecord.warcGz } : {}),
    ...(boundTls ? { boundTls } : {}),
    ...(boundTlsAbsent ? { boundTlsAbsent } : {}),
    ...(pdf.present ? { pdf: pdf.bytes } : {})
  }
}
