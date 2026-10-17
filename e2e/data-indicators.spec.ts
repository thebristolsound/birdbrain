import { test, expect } from './fixtures/electronApp'
import { createCase, mhtmlPage, seedCapture, serverToken } from './fixtures/seed'
import { expectIndicatorsListed, extractedCount, type Indicator } from './fixtures/indicators'

// Data extraction end to end (#598): a Capture's stored MHTML goes to the extraction
// process, and what it finds shows in the Data screen's Indicators group. The values are
// invented, and are ones the extractor keeps rather than drops as placeholders.

const URL = 'https://bulletin.example.org/issue-12'

const INDICATORS: Indicator[] = [
  { category: 'Infrastructure', subcategory: 'Email Address', value: 'wren@desk.example.net' },
  { category: 'Infrastructure', subcategory: 'Domain Reference', value: 'ledger.example.org' },
  { category: 'Infrastructure', subcategory: 'Domain Reference', value: 'desk.example.net' }
]

const PAGE = `<!DOCTYPE html><html><head><title>Harbour bulletin</title></head><body>
<p>Tips go to wren@desk.example.net.</p>
<p>The archive is at <a href="https://ledger.example.org/notes">the ledger</a>.</p>
</body></html>`

test.describe('Data screen indicators', () => {
  test('lists the indicators extracted from a captured page', async ({ page }) => {
    test.setTimeout(60000)
    const caseId = await createCase(page, 'Indicators E2E')
    await seedCapture(page, caseId, await serverToken(page), {
      slug: 'bulletin',
      url: URL,
      title: 'Harbour bulletin',
      mhtml: mhtmlPage(URL, PAGE)
    })

    await expect.poll(() => extractedCount(page, caseId), { timeout: 20000 }).toBe(3)
    await expectIndicatorsListed(page, caseId, INDICATORS)
  })
})
