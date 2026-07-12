import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { initDatabase, closeDatabase, getDb } from '@main/services/db/core'
import { CAPTURE_COLUMNS } from '@main/services/db/captureRepo'

describe('CAPTURE_COLUMNS matches live schema', () => {
  beforeEach(() => initDatabase(':memory:'))
  afterEach(() => closeDatabase())

  it('covers every captures column exactly once, in schema order', () => {
    const info = getDb().pragma('table_info(captures)') as Array<{
      name: string
      dflt_value: string | null
    }>
    expect(CAPTURE_COLUMNS.map((c) => c.column)).toEqual(info.map((i) => i.name))
  })

  it('defaults agree with DDL defaults where DDL declares one', () => {
    const info = getDb().pragma('table_info(captures)') as Array<{
      name: string
      dflt_value: string | null
    }>
    for (const col of info) {
      if (col.dflt_value === null) continue
      const entry = CAPTURE_COLUMNS.find((c) => c.column === col.name)
      expect(entry, `no CAPTURE_COLUMNS entry for column ${col.name}`).toBeDefined()
      // SQLite reports defaults as SQL literals: 'html' → "'html'", 0 → "0"
      const literal =
        typeof entry!.default === 'string' ? `'${entry!.default}'` : String(entry!.default)
      expect(literal, `column ${col.name}`).toBe(col.dflt_value)
    }
  })
})
