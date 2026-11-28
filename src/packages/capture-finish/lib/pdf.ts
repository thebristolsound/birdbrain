import { CaptureInventorySchema } from '@shared/schemas'
import type { CaptureInventory } from '@shared/schemas'
import { MAX_PDF_CONTENT_HEIGHT_PX, MAX_PDF_SIZE } from '@shared/constants'

export type PresentPdf = Extract<CaptureInventory['pdf'], { present: true }>

// The PDF a Capture printed, with its inventory part, or why it has none (step 10 of
// docs/plans/2026-10-10-capture-engine-first-slice.md).
export type PdfOutcome =
  | { present: true; bytes: Buffer; inventory: PresentPdf }
  | { present: false; reason: 'failed'; error: unknown }

/** A Capture Method's way to print the page its browser holds. */
export interface PrintChannel {
  /**
   * Throws, naming the cause, when the browser no longer holds the page the Capture saved. It
   * runs first, before the height is judged, and sends nothing.
   */
  check?(): void
  /**
   * Sends one print command under the method's own bound and resolves the PDF's bytes; rejects
   * with the method's own error. It judges neither the height nor the size.
   */
  print(): Promise<Buffer>
}

// The schema-6 shape of the inventory's PDF part, parsed before it reaches the signed entry, as
// the Transaction Record's part is.
const PdfPartSchema = CaptureInventorySchema.shape.pdf

/**
 * Prints the page to PDF. The caller runs it last, after collection stopped and the other files
 * were taken, so what the page fetches for printing stays out of the Transaction Record (spec,
 * PDF); the part it signs says so. Never throws: a page the channel's check refuses or one taller
 * than MAX_PDF_CONTENT_HEIGHT_PX is not printed, and that, a print that fails or outlasts the
 * method's bound, and a PDF over MAX_PDF_SIZE each record the PDF absent as `failed`, with the
 * error that names the cause. The log drops an error's message, so the height and size
 * refusals also carry a code that says which one refused (#2268).
 */
export async function printPdf(contentHeight: number, channel: PrintChannel): Promise<PdfOutcome> {
  try {
    channel.check?.()
    if (contentHeight > MAX_PDF_CONTENT_HEIGHT_PX) {
      throw Object.assign(
        new Error(
          `The page is ${contentHeight} CSS pixels tall, over MAX_PDF_CONTENT_HEIGHT_PX ` +
            `(${MAX_PDF_CONTENT_HEIGHT_PX}), so it was not printed`
        ),
        { code: 'PDF_TOO_TALL' }
      )
    }
    const bytes = await channel.print()
    if (bytes.length > MAX_PDF_SIZE) {
      throw Object.assign(
        new Error(
          `The PDF is ${bytes.length} bytes, over MAX_PDF_SIZE (${MAX_PDF_SIZE}), so it was ` +
            'discarded'
        ),
        { code: 'PDF_TOO_LARGE' }
      )
    }
    const inventory = PdfPartSchema.parse({ present: true, afterCollection: true }) as PresentPdf
    return { present: true, bytes, inventory }
  } catch (error) {
    return { present: false, reason: 'failed', error }
  }
}
