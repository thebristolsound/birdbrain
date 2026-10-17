import { test, expect } from './fixtures/electronApp'
import type { Page } from '@playwright/test'
import type { DiagnosticsSnapshot } from '@shared/types'
import { createCase, mhtmlPage, seedCapture, serverToken } from './fixtures/seed'
import { expectIndicatorsListed } from './fixtures/indicators'

// A burst of manual captures must not freeze the main process (#598). Each Capture is an
// MHTML page whose cost is in data extraction, which runs in its own process; the main
// process's lag sampler, read through the diagnostics snapshot Settings → Diagnostics
// shows, must record no stall from the start of the burst to the last extraction.

const BURST = 20
// The filler is runs of dotted letters, such as `a.a.a.x`. The rest of ingest stores and
// indexes them quickly; the extractor's indicator matcher is slow on them and keeps none.
// At this size, extracting one page on the main process takes it past the sampler's
// 250 ms stall threshold.
const FILLER_BYTES = 256 * 1024

type DiagnosticsBridge = { birdbrain: { diagnostics: { get: () => Promise<DiagnosticsSnapshot> } } }

function diagnostics(page: Page): Promise<DiagnosticsSnapshot> {
  return page.evaluate(() => (window as unknown as DiagnosticsBridge).birdbrain.diagnostics.get())
}

function burstUrl(i: number): string {
  return `https://burst-${i}.example.org/page`
}

function filler(bytes: number): string {
  const run = `${'a.'.repeat(200)}x`
  return Array.from({ length: Math.ceil(bytes / (run.length + 1)) }, () => run).join(' ')
}

function burstPage(i: number, body: string): string {
  return `<!DOCTYPE html><html><head><title>Burst ${i}</title></head><body>
<p>${body}</p>
<p>Tips go to wren@desk-${i}.example.net, archive at
<a href="https://ledger-${i}.example.org/notes">the ledger</a>.</p>
</body></html>`
}

test.describe('Extraction burst', () => {
  test('a burst of captures does not stall the main process', async ({ page }) => {
    test.setTimeout(240000)
    const caseId = await createCase(page, 'Extraction Burst E2E')
    const token = await serverToken(page)
    const body = filler(FILLER_BYTES)
    const urls = new Set(Array.from({ length: BURST }, (_, i) => burstUrl(i)))

    // The last minute's maximum lag still holds the app's start-up, so it is reported as
    // it stood before the burst too.
    const before = await diagnostics(page)
    const burstStartedAt = await page.evaluate(() => Date.now())
    for (let i = 0; i < BURST; i++) {
      await seedCapture(page, caseId, token, {
        slug: `burst-${i}`,
        url: burstUrl(i),
        title: `Burst ${i}`,
        mhtml: mhtmlPage(burstUrl(i), burstPage(i, body))
      })
    }

    // Each extraction is recorded once it has answered and its rows are written.
    const extractions = async () =>
      (await diagnostics(page)).slowOps.filter(
        ({ kind, detail }) => kind === 'data-extraction' && urls.has(detail)
      )
    await expect.poll(async () => (await extractions()).length, { timeout: 180000 }).toBe(BURST)

    const { eventLoop, slowOps } = await diagnostics(page)
    const stalls = eventLoop.stalls.filter(({ at }) => Date.parse(at) >= burstStartedAt)
    const durations = (kind: string) =>
      slowOps.filter((op) => op.kind === kind && urls.has(op.detail)).map(({ ms }) => ms)
    const report = {
      maxLagLastMinuteMsBefore: before.eventLoop.maxLagLastMinuteMs,
      maxLagLastMinuteMs: eventLoop.maxLagLastMinuteMs,
      stalls,
      dataExtractionMs: durations('data-extraction'),
      fieldIndexMs: durations('field-index')
    }
    console.log(`extraction-burst: ${JSON.stringify(report)}`)
    test.info().annotations.push({ type: 'extraction-burst', description: JSON.stringify(report) })

    // Settings → Diagnostics lists every extraction with the time it took.
    expect(report.dataExtractionMs.every((ms) => ms > 0)).toBe(true)
    expect(stalls).toEqual([])

    const last = BURST - 1
    await expectIndicatorsListed(page, caseId, [
      {
        category: 'Infrastructure',
        subcategory: 'Email Address',
        value: `wren@desk-${last}.example.net`
      },
      {
        category: 'Infrastructure',
        subcategory: 'Domain Reference',
        value: `ledger-${last}.example.org`
      }
    ])
  })
})
