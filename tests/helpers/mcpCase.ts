import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { Readable } from 'stream'
import { ingestMhtmlCapture } from '@main/services/captureLifecycle'
import { listExhibits } from '@main/services/db/exhibitRepo'
import { addTagToCapture, createTag } from '@main/services/db/tagRepo'
import { createSelector, matchSelectorsForCapture } from '@main/services/db/selectorRepo'
import { createNote } from '@main/services/db/noteRepo'
import { insertExtractedData } from '@main/services/db/extractedDataRepo'
import { createWaybackRef } from '@main/services/db/waybackRefRepo'
import { saveAnnotations } from '@main/services/annotations'
import { closeDatabase, initDatabase } from '@main/services/db/core'
import { initStorage } from '@main/services/storage'
import { initSettings, updateSettings } from '@main/services/settings'
import { initInstallationId, resetInstallationId } from '@main/services/installationId'
import { initSigningKey, resetSigningKey } from '@main/services/signingKey'
import { commitStagedFiles, uploadToStaging } from '@main/services/staging'
import { seedMixedKindCase, type MixedKindCase } from './mixedKindCase'

// A Case with one of everything an investigator sees in the app, for the MCP
// server tests (ADR-0036). Built on the mixed-kind fixture, so its Capture,
// uploaded files and manifest are the ones the export tests verify, plus the
// analysis layer: a Tag, a matching selector, a Note that mentions the
// Capture, an extracted email, a pinned Wayback snapshot, an annotation and
// a text file, and a second Capture whose body is real MHTML (the mixed-kind
// Capture's body is bare HTML, which the MHTML decoder rightly reads as empty).
// The caller owns the harness, as seedMixedKindCase documents.

export const MCP_PAGE_TEXT = 'extracted text'
export const MCP_TEXT_FILE = 'Witness statement, taken 2026-04-05.\n'
export const MCP_MHTML_BODY = '<html><body><p>The quoted claim</p></body></html>'

const MHTML = [
  'From: <Saved by Chrome>',
  'MIME-Version: 1.0',
  'Content-Type: multipart/related; boundary="BOUNDARY"; type="text/html"',
  '',
  '--BOUNDARY',
  'Content-Type: text/html; charset=utf-8',
  'Content-Location: https://forum.example.com/post',
  '',
  MCP_MHTML_BODY,
  '--BOUNDARY--',
  ''
].join('\r\n')

export interface McpCase extends MixedKindCase {
  tagId: string
  selectorId: string
  noteId: string
  textFileId: string
  mhtmlCaptureId: string
}

export async function seedMcpCase(tempDir: string): Promise<McpCase> {
  const mixed = await seedMixedKindCase({ tempDir, name: 'MCP Case' })
  const { caseId, captureId } = mixed

  const uploads = join(tempDir, 'uploads-text')
  mkdirSync(uploads, { recursive: true })
  const textPath = join(uploads, 'statement.txt')
  writeFileSync(textPath, MCP_TEXT_FILE)
  const staged = await uploadToStaging(caseId, [textPath])
  await commitStagedFiles(
    caseId,
    staged.map((row) => row.id)
  )
  const textFileId = listExhibits(caseId).find((e) => e.name === 'statement.txt')!.id

  const tag = createTag({ name: 'Lead' })
  addTagToCapture({ captureId, tagId: tag.id })

  const selector = createSelector({ caseId, pattern: 'extracted', label: 'Keyword' })
  matchSelectorsForCapture(captureId, caseId, MCP_PAGE_TEXT)

  const note = createNote({
    caseId,
    captureId,
    title: 'First lead',
    bodyDoc: JSON.stringify({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Seen on ' },
            {
              type: 'mention',
              attrs: { targetType: 'capture', targetId: captureId, label: 'Page' }
            }
          ]
        }
      ]
    })
  })

  insertExtractedData(captureId, caseId, 'https://example.com/page', [
    { category: 'email', subcategory: 'address', value: 'lead@example.com' }
  ])

  createWaybackRef({
    captureId,
    snapshot: {
      timestamp: '2024-01-01T00:00:00.000Z',
      snapshotUrl: 'https://web.archive.org/web/20240101000000/https://example.com/page',
      originalUrl: 'https://example.com/page',
      statusCode: 200
    },
    checkedAt: '2026-04-05T12:10:00.000Z'
  })

  saveAnnotations({ captureId, shapes: [], imageWidth: 24, imageHeight: 24 })

  const { capture: mhtmlCapture } = await ingestMhtmlCapture({
    caseId,
    url: 'https://forum.example.com/post',
    title: 'Forum post',
    timestamp: '2026-04-05T12:20:00.000Z',
    stream: Readable.from([Buffer.from(MHTML)]) as unknown as ReadableStream<Uint8Array>,
    textContent: 'The quoted claim',
    headers: {},
    browserVersion: '',
    userAgent: '',
    httpStatus: 200,
    extensionVersion: '',
    operatorId: 'op',
    operatorName: '',
    toolVersion: '0.1.0'
  })

  return {
    ...mixed,
    tagId: tag.id,
    selectorId: selector.id,
    noteId: note.id,
    textFileId,
    mhtmlCaptureId: mhtmlCapture.id
  }
}

// A whole Birdbrain data folder at `tempDir`, laid out as the app leaves it:
// `birdbrain.db` (closed), `captures/`, `settings.json` and the signing key
// files. The signing key is left unloaded, so the caller chooses how the
// server process loads it.
export async function seedMcpUserData(tempDir: string): Promise<McpCase> {
  initStorage(join(tempDir, 'captures'))
  await initDatabase(join(tempDir, 'birdbrain.db'))
  resetInstallationId()
  initInstallationId(tempDir)
  initSettings(tempDir)
  updateSettings({ operatorName: 'Test Operator' })
  resetSigningKey()
  initSigningKey(tempDir, { confirmUnprotectedKey: () => true })
  const fixture = await seedMcpCase(tempDir)
  closeDatabase()
  resetSigningKey()
  return fixture
}
