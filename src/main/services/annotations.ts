import { randomUUID } from 'crypto'
// eslint-disable-next-line no-restricted-imports -- owns the annotations/annotation_pins aggregate's SQL; repo home resolved by 2026-07-11-capture-row-ownership plan
import { getDb, syncColumnValues, withTransaction, type ImportCtx } from '@main/services/db/core'
import { assertLiveReference } from '@main/services/db/workingRowRepo'
import { deleteLocalRow, signLocalRow } from '@main/services/sharing/workingRows'
import type {
  AnnotationsBundle,
  AnnotationPin,
  AnnotationShape,
  CaptureAnnotations
} from '@shared/types'
import type { SaveAnnotationsParams, UpsertAnnotationPinParams } from '@shared/ipc'

const SCHEMA_VERSION = 1

interface AnnotationRow {
  capture_id: string
  schema_version: number
  shapes_json: string
  image_width: number
  image_height: number
  updated_at: string
  updated_by: string | null
  author_installation_id: string | null
}

interface PinRow {
  id: string
  capture_id: string
  number: number
  body: string
  created_at: string
  updated_at: string
}

function rowToAnnotations(row: AnnotationRow): CaptureAnnotations {
  return {
    captureId: row.capture_id,
    schemaVersion: row.schema_version,
    shapes: JSON.parse(row.shapes_json) as AnnotationShape[],
    imageWidth: row.image_width,
    imageHeight: row.image_height,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by
  }
}

function rowToPin(row: PinRow): AnnotationPin {
  return {
    id: row.id,
    captureId: row.capture_id,
    number: row.number,
    body: row.body,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

// A Capture holds one annotation layer per author since migration 39. This
// installation's layer is the one read, edited and burned into exports; when
// it has none, the layer with the lowest author installation id is read, so
// the choice does not depend on row order. The pins returned are the layer's
// author's: a drawing's pins are numbered within it, and listing another
// member's pins beside it would cite numbers the drawing does not carry.
// Tombstoned layers and pins (#1512) are skipped like removed ones, and so is
// every row on a Capture this database no longer holds: another member's rows
// on a deleted Capture are kept as signed (#1877) and hidden with it.
const CAPTURE_HELD = 'EXISTS (SELECT 1 FROM captures WHERE id = @captureId)'

export function getAnnotations(captureId: string): AnnotationsBundle {
  const annRow = getDb()
    .prepare(
      `SELECT * FROM annotations
        WHERE capture_id = @captureId AND deleted_at IS NULL AND ${CAPTURE_HELD}
       ORDER BY COALESCE(author_installation_id, '')
       LIMIT 1`
    )
    .get({ captureId }) as AnnotationRow | undefined
  const author = annRow?.author_installation_id ?? ''
  const pinRows = getDb()
    .prepare(
      `SELECT * FROM annotation_pins
        WHERE capture_id = @captureId AND COALESCE(author_installation_id, '') = @author
          AND deleted_at IS NULL AND ${CAPTURE_HELD}
        ORDER BY number ASC`
    )
    .all({ captureId, author }) as PinRow[]
  return {
    annotations: annRow ? rowToAnnotations(annRow) : null,
    pins: pinRows.map(rowToPin)
  }
}

export function saveAnnotations(
  params: SaveAnnotationsParams,
  updatedBy: string | null = null
): CaptureAnnotations {
  const now = new Date().toISOString()
  return withTransaction(() => {
    // Upserts this installation's layer, restoring it when it was deleted.
    getDb()
      .prepare(
        `INSERT INTO annotations (capture_id, schema_version, shapes_json, image_width, image_height, updated_at, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(capture_id, COALESCE(author_installation_id, '')) DO UPDATE SET
         schema_version = excluded.schema_version,
         shapes_json = excluded.shapes_json,
         image_width = excluded.image_width,
         image_height = excluded.image_height,
         updated_at = excluded.updated_at,
         updated_by = excluded.updated_by`
      )
      .run(
        params.captureId,
        SCHEMA_VERSION,
        JSON.stringify(params.shapes),
        params.imageWidth,
        params.imageHeight,
        now,
        updatedBy
      )
    signLocalRow('annotations', { capture_id: params.captureId }, { deletedAt: null })
    return rowToAnnotations(
      getDb()
        .prepare(
          "SELECT * FROM annotations WHERE capture_id = ? AND COALESCE(author_installation_id, '') = ''"
        )
        .get(params.captureId) as AnnotationRow
    )
  })
}

// Clears this installation's layer only: another member's drawing is theirs
// to clear.
export function deleteAnnotations(captureId: string): void {
  deleteLocalRow('annotations', { capture_id: captureId })
}

export function upsertPin(params: UpsertAnnotationPinParams): AnnotationPin {
  const db = getDb()
  const now = new Date().toISOString()

  return withTransaction(() => {
    if (params.id) {
      const held = db
        .prepare('SELECT author_installation_id FROM annotation_pins WHERE id = ?')
        .get(params.id) as { author_installation_id: string | null } | undefined
      // Another member's pin is theirs to edit; this installation's own pin
      // is updated, and restored when it had been deleted.
      if (held && held.author_installation_id !== null) {
        throw new Error(`Pin ${params.id} belongs to another member`)
      }
      if (held) {
        db.prepare('UPDATE annotation_pins SET body = ?, updated_at = ? WHERE id = ?').run(
          params.body,
          now,
          params.id
        )
        signLocalRow('annotation_pins', { id: params.id }, { deletedAt: null })
        return rowToPin(
          db.prepare('SELECT * FROM annotation_pins WHERE id = ?').get(params.id) as PinRow
        )
      }
    }

    const id = params.id ?? randomUUID()
    // Numbered within this installation's pins on the Capture, tombstoned
    // ones included so a number is never reused: a member's numbers are
    // its own layer's, and two members numbering one Capture do not collide.
    const row = db
      .prepare(
        `SELECT COALESCE(MAX(number), 0) + 1 AS next FROM annotation_pins
          WHERE capture_id = ? AND author_installation_id IS NULL`
      )
      .get(params.captureId) as { next: number }
    const number = row.next

    db.prepare(
      'INSERT INTO annotation_pins (id, capture_id, number, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(id, params.captureId, number, params.body, now, now)
    signLocalRow('annotation_pins', { id })

    return rowToPin(db.prepare('SELECT * FROM annotation_pins WHERE id = ?').get(id) as PinRow)
  })
}

export function deletePin(pinId: string): void {
  deleteLocalRow('annotation_pins', { id: pinId })
}

// --- Archive bulk ops (this service owns the annotations/annotation_pins SQL) ---

export function collectAnnotationsForCase(caseId: string): Record<string, unknown>[] {
  return getDb()
    .prepare(
      `SELECT a.* FROM annotations a
       JOIN captures c ON c.id = a.capture_id
       WHERE c.case_id = ?`
    )
    .all(caseId) as Record<string, unknown>[]
}

export function collectAnnotationPinsForCase(caseId: string): Record<string, unknown>[] {
  return getDb()
    .prepare(
      `SELECT p.* FROM annotation_pins p
       JOIN captures c ON c.id = p.capture_id
       WHERE c.case_id = ?`
    )
    .all(caseId) as Record<string, unknown>[]
}

export function importAnnotationRows(rows: Record<string, unknown>[], ctx: ImportCtx): void {
  const insert = getDb().prepare(
    `INSERT INTO annotations (capture_id, schema_version, shapes_json, image_width, image_height, updated_at, updated_by,
       author_installation_id, version, deleted_at, row_signature)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
  for (const a of rows) {
    const captureId = ctx.mapId(a.capture_id as string)
    // The archive's Capture must have been imported: no key checks it since v41 (#1877).
    assertLiveReference('annotations', { capture_id: captureId }, 'An archived annotation layer')
    insert.run(
      captureId,
      a.schema_version ?? null,
      a.shapes_json ?? null,
      a.image_width ?? null,
      a.image_height ?? null,
      a.updated_at ?? null,
      a.updated_by ?? null,
      ...syncColumnValues(a)
    )
  }
}

export function importAnnotationPinRows(rows: Record<string, unknown>[], ctx: ImportCtx): void {
  const insert = getDb().prepare(
    `INSERT INTO annotation_pins (id, capture_id, number, body, created_at, updated_at,
       author_installation_id, version, deleted_at, row_signature)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
  for (const p of rows) {
    const captureId = ctx.mapId(p.capture_id as string)
    assertLiveReference('annotation_pins', { capture_id: captureId }, 'An archived pin')
    insert.run(
      ctx.mapId(p.id as string),
      captureId,
      p.number ?? null,
      p.body ?? null,
      p.created_at ?? null,
      p.updated_at ?? null,
      ...syncColumnValues(p)
    )
  }
}
