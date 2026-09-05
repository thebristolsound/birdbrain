import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { initDatabase, closeDatabase } from '@main/services/db/core'
import { createCase } from '@main/services/db/caseRepo'
import { insertCapture } from '@main/services/db/captureRepo'
import {
  addTagToCapture,
  createTag,
  getCapturesWithAnyTag,
  getTagCaptureMatrix
} from '@main/services/db/tagRepo'
import { SIGNAL_COVERAGE_CAPTURES } from '@shared/constants'

// A fixed corpus, deliberately larger than the Signals coverage window, so the
// unbounded read has something the bounded one cannot see. Timestamps descend
// by one day from the newest, so capture N is N days old.
const CORPUS = SIGNAL_COVERAGE_CAPTURES + 6
const NEWEST_MS = Date.UTC(2026, 0, 31, 12, 0, 0)
const DAY_MS = 86_400_000

let caseId: string
let otherCaseId: string
let captureIds: string[]
let alpha: string
let beta: string

function stamp(daysOld: number): string {
  return new Date(NEWEST_MS - daysOld * DAY_MS).toISOString()
}

beforeEach(async () => {
  await initDatabase(':memory:')
  caseId = createCase({ name: 'Meridian', description: '', type: 'custom' }).id
  otherCaseId = createCase({ name: 'Unrelated', description: '', type: 'custom' }).id

  captureIds = Array.from({ length: CORPUS }, (_, i) => {
    return insertCapture({
      caseId,
      url: `https://meridian-trust.example/page-${i}`,
      title: `Page ${i}`,
      hash: `hash-${i}`,
      timestamp: stamp(i),
      textContent: 'body',
      format: 'mhtml'
    }).id
  })

  alpha = createTag({ name: 'alpha' }).id
  beta = createTag({ name: 'beta' }).id
})

afterEach(() => {
  closeDatabase()
})

// The known answer: three tagged captures at fixed positions, one of them
// outside the coverage window, and one capture in another case carrying the
// same tag. Every assertion below is the whole list, not a membership probe.
describe('getCapturesWithAnyTag (#918)', () => {
  const NEW_ALPHA = 1
  const MID_BETA = 4
  const OLD_ALPHA = CORPUS - 1

  beforeEach(() => {
    addTagToCapture({ captureId: captureIds[NEW_ALPHA], tagId: alpha })
    addTagToCapture({ captureId: captureIds[OLD_ALPHA], tagId: alpha })
    addTagToCapture({ captureId: captureIds[MID_BETA], tagId: beta })
  })

  it('returns every capture carrying the tag, newest first, however old', () => {
    expect(getCapturesWithAnyTag(caseId, [alpha])).toEqual([
      captureIds[NEW_ALPHA],
      captureIds[OLD_ALPHA]
    ])
  })

  // The reason this query exists rather than reusing the matrix: the matrix is
  // capped at the coverage window, so the older of the two alpha captures is
  // absent from it. A filter built on it would hide that capture with no sign.
  it('sees the capture the capped coverage matrix cannot', () => {
    const matrix = getTagCaptureMatrix(caseId, SIGNAL_COVERAGE_CAPTURES)

    expect(matrix[alpha]).toEqual([captureIds[NEW_ALPHA]])
    expect(getCapturesWithAnyTag(caseId, [alpha])).toContain(captureIds[OLD_ALPHA])
  })

  it('unions across tags rather than intersecting them', () => {
    expect(getCapturesWithAnyTag(caseId, [alpha, beta])).toEqual([
      captureIds[NEW_ALPHA],
      captureIds[MID_BETA],
      captureIds[OLD_ALPHA]
    ])
  })

  it('lists a capture once when it carries several of the selected tags', () => {
    addTagToCapture({ captureId: captureIds[NEW_ALPHA], tagId: beta })

    expect(getCapturesWithAnyTag(caseId, [alpha, beta])).toEqual([
      captureIds[NEW_ALPHA],
      captureIds[MID_BETA],
      captureIds[OLD_ALPHA]
    ])
  })

  // Tags are app-global. Without the join onto captures this would return the
  // other case's capture too, narrowing one case's list by another's evidence.
  it('never crosses the case boundary a shared tag spans', () => {
    const foreign = insertCapture({
      caseId: otherCaseId,
      url: 'https://elsewhere.example/x',
      title: 'Elsewhere',
      hash: 'hash-foreign',
      timestamp: stamp(0),
      textContent: 'body',
      format: 'mhtml'
    }).id
    addTagToCapture({ captureId: foreign, tagId: alpha })

    expect(getCapturesWithAnyTag(caseId, [alpha])).toEqual([
      captureIds[NEW_ALPHA],
      captureIds[OLD_ALPHA]
    ])
    expect(getCapturesWithAnyTag(otherCaseId, [alpha])).toEqual([foreign])
  })

  it('returns nothing for no tags and for a tag nothing carries', () => {
    expect(getCapturesWithAnyTag(caseId, [])).toEqual([])
    expect(getCapturesWithAnyTag(caseId, ['no-such-tag'])).toEqual([])
  })
})
