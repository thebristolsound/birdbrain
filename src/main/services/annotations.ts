import { randomUUID } from 'crypto'
import { getDb } from './database'
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

export function getAnnotations(captureId: string): AnnotationsBundle {
  const annRow = getDb()
    .prepare('SELECT * FROM annotations WHERE capture_id = ?')
    .get(captureId) as AnnotationRow | undefined
  const pinRows = getDb()
    .prepare('SELECT * FROM annotation_pins WHERE capture_id = ? ORDER BY number ASC')
    .all(captureId) as PinRow[]
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
  getDb()
    .prepare(
      `INSERT INTO annotations (capture_id, schema_version, shapes_json, image_width, image_height, updated_at, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(capture_id) DO UPDATE SET
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
  return rowToAnnotations(
    getDb()
      .prepare('SELECT * FROM annotations WHERE capture_id = ?')
      .get(params.captureId) as AnnotationRow
  )
}

export function deleteAnnotations(captureId: string): void {
  getDb().prepare('DELETE FROM annotations WHERE capture_id = ?').run(captureId)
}

export function upsertPin(params: UpsertAnnotationPinParams): AnnotationPin {
  const db = getDb()
  const now = new Date().toISOString()

  return db.transaction(() => {
    if (params.id) {
      const existing = db.prepare('SELECT * FROM annotation_pins WHERE id = ?').get(params.id) as
        | PinRow
        | undefined
      if (existing) {
        db.prepare('UPDATE annotation_pins SET body = ?, updated_at = ? WHERE id = ?').run(
          params.body,
          now,
          params.id
        )
        return rowToPin(
          db.prepare('SELECT * FROM annotation_pins WHERE id = ?').get(params.id) as PinRow
        )
      }
    }

    const id = params.id ?? randomUUID()
    const row = db
      .prepare(
        'SELECT COALESCE(MAX(number), 0) + 1 AS next FROM annotation_pins WHERE capture_id = ?'
      )
      .get(params.captureId) as { next: number }
    const number = row.next

    db.prepare(
      'INSERT INTO annotation_pins (id, capture_id, number, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(id, params.captureId, number, params.body, now, now)

    return rowToPin(db.prepare('SELECT * FROM annotation_pins WHERE id = ?').get(id) as PinRow)
  })()
}

export function deletePin(pinId: string): void {
  getDb().prepare('DELETE FROM annotation_pins WHERE id = ?').run(pinId)
}
