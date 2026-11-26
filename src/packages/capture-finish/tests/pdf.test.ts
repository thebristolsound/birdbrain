import { describe, expect, it } from 'vitest'
import { printPdf } from '../pdf'
import type { PrintChannel } from '../pdf'
import { MAX_PDF_CONTENT_HEIGHT_PX, MAX_PDF_SIZE } from '@shared/constants'

// The PDF step over a print channel a test hands it: its order, its two limits, and what each
// failure records.

const PRINTED = Buffer.from('%PDF-1.4 invented print')

function channel(overrides: Partial<PrintChannel> = {}) {
  const steps: string[] = []
  const value: PrintChannel = {
    check: () => void steps.push('check'),
    print: async () => {
      steps.push('print')
      return PRINTED
    },
    ...overrides
  }
  return { value, steps }
}

// Only its length is read, so no buffer of the limit's size is made.
const ofLength = (length: number): Buffer => ({ length }) as Buffer

describe('printPdf', () => {
  it('checks the page, prints, and signs that the print came after collection', async () => {
    const { value, steps } = channel()
    await expect(printPdf(100, value)).resolves.toEqual({
      present: true,
      bytes: PRINTED,
      inventory: { present: true, afterCollection: true }
    })
    expect(steps).toEqual(['check', 'print'])
  })

  it('prints through a channel that has no check', async () => {
    const { value, steps } = channel({ check: undefined })
    await expect(printPdf(100, value)).resolves.toMatchObject({ present: true, bytes: PRINTED })
    expect(steps).toEqual(['print'])
  })

  it('does not print a page the check refuses, and names the cause before the height', async () => {
    const refused = new Error('The page navigated after it was saved')
    const { value, steps } = channel({
      check: () => {
        throw refused
      }
    })
    await expect(printPdf(MAX_PDF_CONTENT_HEIGHT_PX + 1, value)).resolves.toEqual({
      present: false,
      reason: 'failed',
      error: refused
    })
    expect(steps).toEqual([])
  })

  it('does not print a page taller than the layout bound, and prints one exactly at it', async () => {
    const tall = channel()
    const outcome = await printPdf(MAX_PDF_CONTENT_HEIGHT_PX + 1, tall.value)
    expect(outcome).toMatchObject({ present: false, reason: 'failed' })
    expect(String(outcome.present || outcome.error)).toBe(
      `Error: The page is ${MAX_PDF_CONTENT_HEIGHT_PX + 1} CSS pixels tall, over ` +
        `MAX_PDF_CONTENT_HEIGHT_PX (${MAX_PDF_CONTENT_HEIGHT_PX}), so it was not printed`
    )
    expect(outcome).toHaveProperty('error.code', 'PDF_TOO_TALL')
    expect(tall.steps).toEqual(['check'])

    const at = channel()
    await expect(printPdf(MAX_PDF_CONTENT_HEIGHT_PX, at.value)).resolves.toMatchObject({
      present: true
    })
    expect(at.steps).toEqual(['check', 'print'])
  })

  it('discards a PDF over the size limit, and keeps one exactly at it', async () => {
    const over = await printPdf(
      100,
      channel({ print: async () => ofLength(MAX_PDF_SIZE + 1) }).value
    )
    expect(over).toMatchObject({ present: false, reason: 'failed' })
    expect(over).not.toHaveProperty('bytes')
    expect(String(over.present || over.error)).toBe(
      `Error: The PDF is ${MAX_PDF_SIZE + 1} bytes, over MAX_PDF_SIZE (${MAX_PDF_SIZE}), so it ` +
        'was discarded'
    )
    expect(over).toHaveProperty('error.code', 'PDF_TOO_LARGE')
    const at = ofLength(MAX_PDF_SIZE)
    await expect(printPdf(100, channel({ print: async () => at }).value)).resolves.toMatchObject({
      present: true,
      bytes: at
    })
  })

  const thrown = new Error('thrown by the method')
  it.each<[string, PrintChannel['print']]>([
    ['rejects', () => Promise.reject(thrown)],
    [
      'throws as it starts',
      () => {
        throw thrown
      }
    ]
  ])(
    'records the PDF failed, with the error as thrown, when the print %s',
    async (_name, print) => {
      await expect(printPdf(100, channel({ print }).value)).resolves.toEqual({
        present: false,
        reason: 'failed',
        error: thrown
      })
    }
  )
})
