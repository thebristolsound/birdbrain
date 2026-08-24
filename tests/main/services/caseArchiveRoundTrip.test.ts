import { describe, it, expect, afterEach } from 'vitest'
import { initDatabase, closeDatabase, getDb, withTransaction } from '@main/services/db/core'
import type { ImportCtx } from '@main/services/db/core'
import {
  createCase,
  getCase,
  updateCase,
  collectCaseRow,
  importCaseRow,
  getAutoCapturePolicy,
  setAutoCapturePolicy
} from '@main/services/db/caseRepo'
import {
  insertCapture,
  setCaptureVerification,
  setCaptureTrustedTime,
  toggleFavorite,
  getCaptureTextContent,
  collectCapturesForCase,
  collectCaptureFavoritesForCase,
  importCaptureRows,
  importCaptureFavoriteRows
} from '@main/services/db/captureRepo'
import {
  createTag,
  addTagToCapture,
  collectTagsForCase,
  collectCaptureTagsForCase,
  collectNoteTagsForCase,
  getTagsForNote,
  addTagToNote,
  importTagRows,
  importCaptureTagRows,
  importNoteTagRows
} from '@main/services/db/tagRepo'
import {
  createSelector,
  matchSelectorAgainstCaptures,
  collectSelectorsForCase,
  collectSelectorMatchesForCase,
  importSelectorRows,
  importSelectorMatchRows
} from '@main/services/db/selectorRepo'
import { createNote, collectNotesForCase, importNoteRows } from '@main/services/db/noteRepo'
import {
  createWaybackRef,
  collectWaybackRefsForCase,
  importWaybackRefRows
} from '@main/services/db/waybackRefRepo'
import {
  insertExtractedData,
  collectExtractedDataForCase,
  importExtractedDataRows
} from '@main/services/db/extractedDataRepo'
import {
  collectAnnotationsForCase,
  collectAnnotationPinsForCase,
  importAnnotationRows,
  importAnnotationPinRows
} from '@main/services/annotations'
import {
  collectCaptureAnalysesForCase,
  importCaptureAnalysisRows
} from '@main/services/ai/analysisService'

type Row = Record<string, unknown>

const NEW_CASE = 'imported-case-id'
const mapId = (id: string): string => `X-${id}`
const mapTag = (id: string): string => id
const ctx: ImportCtx = {
  newCaseId: NEW_CASE,
  mapId,
  mapTag,
  getText: (oldId) => `text-of-${oldId}`
}

const byId = (a: Row, b: Row) => String(a.id).localeCompare(String(b.id))

describe('case archive round-trip fidelity (repo bulk ops)', () => {
  afterEach(() => closeDatabase())

  it('every table survives field-for-field modulo intended transforms', async () => {
    await initDatabase(':memory:')
    const c = createCase({ name: 'Source', description: 'src', type: 'custom' })
    // A non-default auto-capture policy (#400). With the columns left NULL the
    // case-row comparison at the bottom passes even if importCaseRow never
    // learns them, so the archive would silently drop the exclusion list — and
    // a re-imported case would capture pages the operator excluded.
    setAutoCapturePolicy(c.id, {
      exclusions: ['*.bank.com', '/\\.gov(\\.|\\/|$)/i'],
      mode: 'override'
    })
    // A case number and the demo flag (#399/#405), set for the same reason the
    // policy above is non-default: left NULL/0, the verbatim case-row
    // comparison passes even if importCaseRow silently drops the columns — and
    // a re-imported demo case would present as an ordinary case.
    updateCase({ id: c.id, caseNumber: 'CPS 2026/114' })
    getDb().prepare('UPDATE cases SET is_demo = 1 WHERE id = ?').run(c.id)

    // Two captures with full provenance: cap2 supersedes cap1, non-default
    // method, consent suppression, TLS chain, verification + trusted time.
    const cap1 = insertCapture({
      caseId: c.id,
      url: 'https://a.example',
      title: 'A',
      hash: 'h1',
      timestamp: '2026-01-01T00:00:00Z',
      textContent: 'alpha text',
      format: 'mhtml',
      mhtmlPath: `${c.id}/cap1.mhtml`,
      sizeBytes: 111,
      manifestIndex: 0,
      entryHash: 'e1',
      operatorId: 'op-1',
      operatorName: 'Op'
    })
    const cap2 = insertCapture({
      caseId: c.id,
      url: 'https://b.example',
      title: 'B',
      hash: 'h2',
      timestamp: '2026-01-02T00:00:00Z',
      textContent: 'bravo text',
      format: 'mhtml',
      method: 'background',
      supersedesCaptureId: cap1.id,
      consentSuppression: 'filter-list',
      tlsCertChain: '{"status":"unavailable"}'
    })
    setCaptureVerification(cap1.id, {
      status: 'verified',
      computedHash: 'h1',
      verifiedAt: '2026-01-03T00:00:00Z'
    })
    setCaptureTrustedTime(cap2.id, 'pending')
    toggleFavorite(cap1.id)

    const tag = createTag({ name: 'Evidence', color: '#f00' })
    addTagToCapture({ captureId: cap1.id, tagId: tag.id })

    // Non-null origin, deliberately: with NULL the deep column comparison
    // below passes even if importSelectorRows never learns the column (#395).
    const sel = createSelector({
      caseId: c.id,
      pattern: 'alpha',
      isRegex: false,
      origin: 'extension'
    })
    matchSelectorAgainstCaptures(sel.id, [{ captureId: cap1.id, text: 'alpha text' }])
    // And one without, so NULL-survives-as-NULL is covered in the same pass.
    createSelector({ caseId: c.id, pattern: 'legacy', isRegex: false })

    // Rich body, so the deep column comparison below covers body_doc too.
    const note = createNote({
      caseId: c.id,
      captureId: cap1.id,
      title: 'N',
      bodyDoc: JSON.stringify({
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'note body' }] }]
      })
    })
    // Note-level tags (#391). Two of them, deliberately: `tag` is also on a
    // capture, so it would survive the round trip through capture_tags alone,
    // while `noteOnlyTag` reaches the archive ONLY through note_tags — with
    // collectTagsForCase left un-unioned, the note_tags row would cite a tag
    // absent from data.json and the import would fail its foreign key.
    const noteOnlyTag = createTag({ name: 'Analyst note', color: '#0f0' })
    addTagToNote({ noteId: note.id, tagId: tag.id })
    addTagToNote({ noteId: note.id, tagId: noteOnlyTag.id })

    insertExtractedData(cap1.id, c.id, 'https://a.example', [
      { category: 'contact', subcategory: 'email', value: 'a@example.com' }
    ])
    createWaybackRef({
      captureId: cap1.id,
      checkedAt: '2026-01-06T00:00:00Z',
      snapshot: {
        timestamp: '2026-01-01T00:00:00Z',
        snapshotUrl: 'https://web.archive.org/web/x',
        originalUrl: 'https://a.example',
        digest: 'd1',
        statusCode: 200,
        mimeType: 'text/html'
      }
    })
    // Annotations/pins/analyses: seed through the bulk import ops with an
    // identity ctx targeting the SOURCE case (their interactive write paths
    // need renderer payloads).
    const identity: ImportCtx = {
      newCaseId: c.id,
      mapId: (id) => id,
      mapTag: (id) => id,
      getText: () => ''
    }
    importAnnotationRows(
      [
        {
          capture_id: cap1.id,
          schema_version: 1,
          shapes_json: '[]',
          image_width: 800,
          image_height: 600,
          updated_at: '2026-01-04T00:00:00Z',
          updated_by: 'Op'
        }
      ],
      identity
    )
    importAnnotationPinRows(
      [
        {
          id: 'pin-1',
          capture_id: cap1.id,
          number: 1,
          body: 'pin body',
          created_at: '2026-01-04T00:00:00Z',
          updated_at: '2026-01-04T00:00:00Z'
        }
      ],
      identity
    )
    importCaptureAnalysisRows(
      [
        {
          id: 'an-1',
          capture_id: cap1.id,
          case_id: c.id,
          content: 'analysis',
          model: 'm',
          token_usage: 10,
          created_at: '2026-01-05T00:00:00Z',
          updated_at: '2026-01-05T00:00:00Z'
        }
      ],
      identity
    )

    // Collect everything, then import into a FRESH database.
    const src = {
      case: collectCaseRow(c.id),
      captures: collectCapturesForCase(c.id),
      tags: collectTagsForCase(c.id),
      captureTags: collectCaptureTagsForCase(c.id),
      noteTags: collectNoteTagsForCase(c.id),
      selectors: collectSelectorsForCase(c.id),
      selectorMatches: collectSelectorMatchesForCase(c.id),
      notes: collectNotesForCase(c.id),
      captureFavorites: collectCaptureFavoritesForCase(c.id),
      annotations: collectAnnotationsForCase(c.id),
      annotationPins: collectAnnotationPinsForCase(c.id),
      captureAnalyses: collectCaptureAnalysesForCase(c.id),
      extractedData: collectExtractedDataForCase(c.id),
      captureArchiveRefs: collectWaybackRefsForCase(c.id)
    }
    closeDatabase()
    await initDatabase(':memory:')

    withTransaction(() => {
      importCaseRow(src.case, ctx)
      importTagRows(src.tags) // fresh DB: ids free, no merge needed
      importCaptureRows(src.captures, ctx)
      importCaptureTagRows(src.captureTags, ctx)
      importSelectorRows(src.selectors, ctx)
      importSelectorMatchRows(src.selectorMatches, ctx)
      importCaptureFavoriteRows(src.captureFavorites, ctx)
      importAnnotationRows(src.annotations, ctx)
      importAnnotationPinRows(src.annotationPins, ctx)
      importCaptureAnalysisRows(src.captureAnalyses, ctx)
      importExtractedDataRows(src.extractedData, ctx)
      importWaybackRefRows(src.captureArchiveRefs, ctx)
      importNoteRows(src.notes, ctx)
      // After the notes, whose rows note_tags has a foreign key onto (#391).
      importNoteTagRows(src.noteTags, ctx)
    })

    // Captures: field-for-field modulo id/case_id/supersedes remap.
    const expectedCaptures = src.captures
      .map((r) => ({
        ...r,
        id: mapId(r.id as string),
        case_id: NEW_CASE,
        supersedes_capture_id: r.supersedes_capture_id
          ? mapId(r.supersedes_capture_id as string)
          : null
      }))
      .sort(byId)
    expect(collectCapturesForCase(NEW_CASE).sort(byId)).toEqual(expectedCaptures)

    // The intended transforms, asserted explicitly:
    const imported2 = collectCapturesForCase(NEW_CASE).find(
      (r) => r.id === mapId(cap2.id)
    ) as Row
    expect(imported2.supersedes_capture_id).toBe(mapId(cap1.id)) // REMAPPED, not copied
    expect(imported2.method).toBe('background') // non-default survived
    expect(imported2.consent_suppression).toBe('filter-list')

    // Extracted Text arrives via ctx.getText (staged sidecars in production).
    expect(getCaptureTextContent(mapId(cap1.id))).toBe(`text-of-${cap1.id}`)

    // Every other table: deep equality after its transform.
    expect(collectTagsForCase(NEW_CASE).sort(byId)).toEqual([...src.tags].sort(byId))
    expect(collectCaptureTagsForCase(NEW_CASE)).toEqual(
      src.captureTags.map((r) => ({ ...r, capture_id: mapId(r.capture_id as string) }))
    )
    expect(collectSelectorsForCase(NEW_CASE).sort(byId)).toEqual(
      src.selectors
        .map((r) => ({ ...r, id: mapId(r.id as string), case_id: NEW_CASE }))
        .sort(byId)
    )
    expect(collectSelectorMatchesForCase(NEW_CASE)).toEqual(
      src.selectorMatches.map((r) => ({
        ...r,
        selector_id: mapId(r.selector_id as string),
        capture_id: mapId(r.capture_id as string)
      }))
    )
    expect(collectNotesForCase(NEW_CASE).sort(byId)).toEqual(
      src.notes
        .map((r) => ({
          ...r,
          id: mapId(r.id as string),
          case_id: NEW_CASE,
          capture_id: r.capture_id ? mapId(r.capture_id as string) : null
        }))
        .sort(byId)
    )
    // Note tags (#391): both links survive with the note id remapped, and the
    // note-only tag came across with them.
    expect(collectNoteTagsForCase(NEW_CASE)).toEqual(
      src.noteTags.map((r) => ({ ...r, note_id: mapId(r.note_id as string) }))
    )
    expect(getTagsForNote(mapId(note.id)).map((t) => t.name).sort()).toEqual([
      'Analyst note',
      'Evidence'
    ])
    expect(collectCaptureFavoritesForCase(NEW_CASE)).toEqual(
      src.captureFavorites.map((r) => ({ ...r, capture_id: mapId(r.capture_id as string) }))
    )
    expect(collectAnnotationsForCase(NEW_CASE)).toEqual(
      src.annotations.map((r) => ({ ...r, capture_id: mapId(r.capture_id as string) }))
    )
    expect(collectAnnotationPinsForCase(NEW_CASE)).toEqual(
      src.annotationPins.map((r) => ({
        ...r,
        id: mapId(r.id as string),
        capture_id: mapId(r.capture_id as string)
      }))
    )
    expect(collectCaptureAnalysesForCase(NEW_CASE)).toEqual(
      src.captureAnalyses.map((r) => ({
        ...r,
        id: mapId(r.id as string),
        capture_id: mapId(r.capture_id as string),
        case_id: NEW_CASE
      }))
    )
    expect(collectExtractedDataForCase(NEW_CASE).sort(byId)).toEqual(
      src.extractedData
        .map((r) => ({
          ...r,
          id: mapId(r.id as string),
          capture_id: mapId(r.capture_id as string),
          case_id: NEW_CASE
        }))
        .sort(byId)
    )
    expect(collectWaybackRefsForCase(NEW_CASE)).toEqual(
      src.captureArchiveRefs.map((r) => ({
        ...r,
        id: mapId(r.id as string),
        capture_id: mapId(r.capture_id as string)
      }))
    )
    // Case row itself (id replaced, everything else verbatim).
    expect(collectCaseRow(NEW_CASE)).toEqual({ ...src.case, id: NEW_CASE })
    // And read back through the repo, not just as raw columns: the imported
    // case must enforce the policy it was exported under (#400).
    expect(getAutoCapturePolicy(NEW_CASE)).toEqual({
      exclusions: ['*.bank.com', '/\\.gov(\\.|\\/|$)/i'],
      mode: 'override'
    })
    // The case number survives and the demo case still identifies itself as
    // one after the round trip (#399/#405).
    expect(getCase(NEW_CASE)?.caseNumber).toBe('CPS 2026/114')
    expect(getCase(NEW_CASE)?.isDemo).toBe(true)
  })

  // A pre-v30 archive has no exclusion keys on its case row. It must import as
  // the default policy rather than throwing or writing junk — the same "no
  // exclusions, stack on global" a case that never set one reads as.
  it('an archive case row without exclusion columns imports as the default policy', async () => {
    await initDatabase(':memory:')
    withTransaction(() => {
      importCaseRow(
        {
          id: 'src',
          name: 'Old Epoch',
          type: 'custom',
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z'
        },
        ctx
      )
    })

    expect(getAutoCapturePolicy(NEW_CASE)).toEqual({ exclusions: [], mode: 'stack' })
    // Pre-v31 rows also carry no case_number/is_demo keys (#399): they import
    // as never-numbered and not-a-demo rather than throwing.
    expect(getCase(NEW_CASE)?.caseNumber).toBeUndefined()
    expect(getCase(NEW_CASE)?.isDemo).toBe(false)
  })

  it('old-epoch archive rows (missing method/supersedes/consent columns) import with DDL defaults', async () => {
    await initDatabase(':memory:')
    createCase({ name: 'Target', description: '', type: 'custom' })
    // A pre-v23 archive row: none of the provenance columns exist as keys.
    const oldEpochRow: Row = {
      id: 'old-cap',
      case_id: 'ignored',
      url: 'https://old.example',
      title: 'Old',
      hash: 'h',
      timestamp: '2024-01-01T00:00:00Z',
      created_at: '2024-01-01T00:00:00Z'
    }
    withTransaction(() => {
      importCaseRow(
        {
          id: 'src',
          name: 'S',
          type: 'custom',
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z'
        },
        ctx
      )
      importCaptureRows([oldEpochRow], ctx)
    })
    const [row] = collectCapturesForCase(NEW_CASE) as Row[]
    expect(row.method).toBe('extension')
    expect(row.supersedes_capture_id).toBeNull()
    expect(row.consent_suppression).toBeNull()
    expect(row.format).toBe('html')
  })
})
