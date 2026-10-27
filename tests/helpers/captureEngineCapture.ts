import { writeFileSync } from 'fs'
import { insertCapture } from '@main/services/db/captureRepo'
import { withCaptureEntry, type CaptureEntryContext } from '@main/services/manifest'
import type { CaptureStore } from '@main/services/captureStore'
import { BoundTlsSchema, CaptureInventorySchema, ScrollToLoadRecordSchema } from '@shared/schemas'
import type { Capture } from '@shared/types'
import {
  ENGINE_BOUND_TLS,
  ENGINE_FILES,
  ENGINE_HASHES,
  ENGINE_INVENTORY,
  ENGINE_SCROLL_TO_LOAD
} from './captureEnginePackage'

// A Capture in a Case whose signed entry carries the capture engine's fields
// (docs/plans/2026-10-10-capture-engine-first-slice.md, D1), with every file
// the entry anchors in the Case directory. Built by hand, because nothing in
// the app writes the fields or the Transaction Record and PDF yet. The caller
// owns the database, the storage root, the signing key and the Case's
// manifest.

export type EngineEntryFields = Pick<
  CaptureEntryContext,
  'inventory' | 'scrollToLoad' | 'transactionRecordHash' | 'boundTls' | 'boundTlsAbsent' | 'pdfHash'
>

export const ENGINE_ENTRY_FIELDS: EngineEntryFields = {
  inventory: CaptureInventorySchema.parse(ENGINE_INVENTORY),
  scrollToLoad: ScrollToLoadRecordSchema.parse(ENGINE_SCROLL_TO_LOAD),
  transactionRecordHash: ENGINE_HASHES.transactionRecord,
  boundTls: BoundTlsSchema.parse(ENGINE_BOUND_TLS),
  pdfHash: ENGINE_HASHES.pdf
}

export const ENGINE_URL = 'https://example.com/engine'
export const ENGINE_TIMESTAMP = '2026-10-18T12:00:00.000Z'

export async function seedEngineCapture(params: {
  caseDir: string
  caseId: string
  captureId: string
  store: CaptureStore
  fields?: EngineEntryFields
}): Promise<Capture> {
  const { caseDir, caseId, captureId, store, fields = ENGINE_ENTRY_FIELDS } = params
  const mhtml = store.artifactPaths(caseId, captureId, 'mhtml')
  writeFileSync(mhtml.abs, ENGINE_FILES.page)
  const screenshot = store.writeScreenshot(caseId, captureId, ENGINE_FILES.screenshot)
  store.writeTransactionRecord(caseId, captureId, ENGINE_FILES.transactionRecord)
  store.writePdf(caseId, captureId, ENGINE_FILES.pdf)
  const sizeBytes = ENGINE_FILES.page.length
  return withCaptureEntry(
    caseDir,
    {
      captureId,
      caseId,
      url: ENGINE_URL,
      timestamp: ENGINE_TIMESTAMP,
      contentHash: ENGINE_HASHES.page,
      screenshotHash: ENGINE_HASHES.screenshot,
      method: 'background',
      ...fields,
      sizeBytes,
      operatorId: 'op-engine',
      operatorName: 'Engine Operator',
      toolVersion: '0.1.0'
    },
    ({ index, prevHash, entryHash }) =>
      insertCapture({
        id: captureId,
        caseId,
        url: ENGINE_URL,
        title: 'Engine',
        hash: ENGINE_HASHES.page,
        timestamp: ENGINE_TIMESTAMP,
        format: 'mhtml',
        mhtmlPath: mhtml.rel,
        screenshotPath: screenshot.rel,
        screenshotHash: ENGINE_HASHES.screenshot,
        method: 'background',
        sizeBytes,
        manifestIndex: index,
        prevHash,
        entryHash
      })
  )
}
