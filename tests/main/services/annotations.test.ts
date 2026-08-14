import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { initDatabase, closeDatabase } from '@main/services/db/core'
import { createCase } from '@main/services/db/caseRepo'
import { insertCapture, deleteCapture } from '@main/services/db/captureRepo'
import {
  getAnnotations,
  saveAnnotations,
  deleteAnnotations,
  upsertPin,
  deletePin
} from '@main/services/annotations'
import type { AnnotationShape } from '@shared/types'

describe('annotations service', () => {
  beforeEach(async () => {
    await initDatabase(':memory:')
  })
  afterEach(() => {
    closeDatabase()
  })

  function makeCapture() {
    const c = createCase({ name: 'C' })
    return insertCapture({
      caseId: c.id,
      url: 'https://example.com',
      title: 'Example',
      hash: 'abc',
      timestamp: new Date().toISOString()
    })
  }

  it('returns empty bundle for capture with no annotations', () => {
    const cap = makeCapture()
    const bundle = getAnnotations(cap.id)
    expect(bundle.annotations).toBeNull()
    expect(bundle.pins).toEqual([])
  })

  it('saves and retrieves annotations', () => {
    const cap = makeCapture()
    const shapes: AnnotationShape[] = [
      { kind: 'rect', id: 's1', x: 10, y: 20, w: 30, h: 40, stroke: '#f00', strokeWidth: 2 }
    ]
    const saved = saveAnnotations({ captureId: cap.id, shapes, imageWidth: 800, imageHeight: 600 })
    expect(saved.captureId).toBe(cap.id)
    expect(saved.shapes).toEqual(shapes)
    expect(saved.schemaVersion).toBe(1)
    const bundle = getAnnotations(cap.id)
    expect(bundle.annotations?.shapes).toEqual(shapes)
  })

  it('overwrites existing annotations on save', () => {
    const cap = makeCapture()
    saveAnnotations({ captureId: cap.id, shapes: [], imageWidth: 100, imageHeight: 100 })
    const second = saveAnnotations({
      captureId: cap.id,
      shapes: [{ kind: 'rect', id: 's1', x: 0, y: 0, w: 1, h: 1, stroke: '#000', strokeWidth: 1 }],
      imageWidth: 100,
      imageHeight: 100
    })
    expect(second.shapes).toHaveLength(1)
  })

  it('deletes annotations', () => {
    const cap = makeCapture()
    saveAnnotations({ captureId: cap.id, shapes: [], imageWidth: 100, imageHeight: 100 })
    deleteAnnotations(cap.id)
    expect(getAnnotations(cap.id).annotations).toBeNull()
  })

  it('allocates pin numbers ascending starting at 1', () => {
    const cap = makeCapture()
    const p1 = upsertPin({ captureId: cap.id, body: 'first' })
    const p2 = upsertPin({ captureId: cap.id, body: 'second' })
    const p3 = upsertPin({ captureId: cap.id, body: 'third' })
    expect(p1.number).toBe(1)
    expect(p2.number).toBe(2)
    expect(p3.number).toBe(3)
  })

  it('keeps pin numbers stable after delete (gaps allowed)', () => {
    const cap = makeCapture()
    upsertPin({ captureId: cap.id, body: 'a' })
    const p2 = upsertPin({ captureId: cap.id, body: 'b' })
    upsertPin({ captureId: cap.id, body: 'c' })
    deletePin(p2.id)
    const p4 = upsertPin({ captureId: cap.id, body: 'd' })
    expect(p4.number).toBe(4)
    const numbers = getAnnotations(cap.id)
      .pins.map((p) => p.number)
      .sort((a, b) => a - b)
    expect(numbers).toEqual([1, 3, 4])
  })

  it('updates an existing pin body when id is provided', () => {
    const cap = makeCapture()
    const p = upsertPin({ captureId: cap.id, body: 'original' })
    const updated = upsertPin({ captureId: cap.id, id: p.id, body: 'updated' })
    expect(updated.id).toBe(p.id)
    expect(updated.number).toBe(p.number)
    expect(updated.body).toBe('updated')
  })

  it('inserts a new pin when id is provided but does not exist', () => {
    const cap = makeCapture()
    const created = upsertPin({ captureId: cap.id, id: 'caller-supplied-id', body: 'fresh' })
    expect(created.id).toBe('caller-supplied-id')
    expect(created.number).toBe(1)
    expect(created.body).toBe('fresh')
  })

  it('scopes pin numbering per capture', () => {
    const cap1 = makeCapture()
    const cap2 = makeCapture()
    const a = upsertPin({ captureId: cap1.id, body: 'cap1-a' })
    const b = upsertPin({ captureId: cap2.id, body: 'cap2-a' })
    expect(a.number).toBe(1)
    expect(b.number).toBe(1)
  })

  it('cascades pin deletion when capture is deleted', () => {
    const cap = makeCapture()
    upsertPin({ captureId: cap.id, body: 'x' })
    deleteCapture(cap.id)
    expect(getAnnotations(cap.id).pins).toEqual([])
  })
})
