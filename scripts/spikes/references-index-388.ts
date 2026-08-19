/**
 * Spike #388: references-index extraction over real case data.
 *
 * Interactive, not a test. Bundle and run:
 *
 *   node_modules/.bin/esbuild scripts/spikes/references-index-388.ts --bundle --platform=node \
 *     --external:better-sqlite3 --alias:@shared=./src/shared --outfile=out/spike-388.cjs \
 *   && ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron out/spike-388.cjs <path-to-birdbrain.db>
 *
 * The db argument is COPIED to a temp file; the source is never opened for write.
 * Findings are recorded in docs/specs/2026-08-18-references-index-spike.md.
 */
import Database from 'better-sqlite3'
import { copyFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { randomUUID } from 'node:crypto'
import { getSchema, Node as TiptapNode, generateText, type JSONContent } from '@tiptap/core'
import { Node as PMNode, type Schema } from '@tiptap/pm/model'
import { noteExtensions } from '@shared/noteDoc'

// ---------------------------------------------------------------------------
// Candidate Mention node. Identity = (targetType, targetId). `label` is a
// display cache only and is never used to resolve anything.
// ---------------------------------------------------------------------------
type TargetType = 'capture' | 'selector' | 'tag' | 'note'
const TARGET_TYPES: TargetType[] = ['capture', 'selector', 'tag', 'note']

const Mention = TiptapNode.create({
  name: 'mention',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      targetType: { default: null },
      targetId: { default: null },
      label: { default: '' }
    }
  },
  renderText({ node }) {
    return `@${node.attrs.label || node.attrs.targetType}`
  },
  parseHTML() {
    return [{ tag: 'span[data-mention]' }]
  },
  renderHTML({ node }) {
    return [
      'span',
      {
        'data-mention': '',
        'data-target-type': node.attrs.targetType,
        'data-target-id': node.attrs.targetId
      },
      `@${node.attrs.label}`
    ]
  }
})

const extensions = [...noteExtensions(), Mention]
let schemaCache: Schema | null = null
const schema = (): Schema => (schemaCache ??= getSchema(extensions))

interface Ref {
  targetType: TargetType
  targetId: string
  ord: number
}

// Extraction A: walk the raw JSON. No ProseMirror allocation.
function extractFromJson(doc: JSONContent): Ref[] {
  const out: Ref[] = []
  const walk = (n: JSONContent): void => {
    if (n.type === 'mention') {
      out.push({
        targetType: n.attrs?.targetType,
        targetId: n.attrs?.targetId,
        ord: out.length
      })
      return
    }
    n.content?.forEach(walk)
  }
  walk(doc)
  return out
}

// Extraction B: through the validated PM tree (what parseNoteDoc already builds).
function extractFromPm(node: PMNode): Ref[] {
  const out: Ref[] = []
  node.descendants((n) => {
    if (n.type.name === 'mention') {
      out.push({ targetType: n.attrs.targetType, targetId: n.attrs.targetId, ord: out.length })
      return false
    }
    return true
  })
  return out
}

// Structural validation of Mention attrs. PM's check() only enforces content
// expressions; attrs with `default: null` are accepted as null. This is the
// gate #389 needs in parseNoteDoc.
function validateRefs(refs: Ref[]): void {
  for (const r of refs) {
    if (!TARGET_TYPES.includes(r.targetType))
      throw new Error(`mention: bad targetType ${String(r.targetType)}`)
    if (typeof r.targetId !== 'string' || r.targetId.length === 0 || r.targetId.length > 128) {
      throw new Error('mention: bad targetId')
    }
  }
}

// ---------------------------------------------------------------------------
// Realistic doc generator
// ---------------------------------------------------------------------------
const WORDS =
  'the suspect posted from this account on the forum and linked to the domain which resolves to a hosting provider in the same range as the earlier capture see also the selector match'.split(
    ' '
  )
function rand(n: number): number {
  return Math.floor(Math.random() * n)
}
function pick<T>(xs: T[]): T {
  return xs[rand(xs.length)]
}
function sentence(len: number): string {
  const w: string[] = []
  for (let i = 0; i < len; i++) w.push(pick(WORDS))
  return w.join(' ')
}

interface Pool {
  captures: string[]
  selectors: string[]
  tags: string[]
  notes: string[]
}

function mentionNode(pool: Pool): JSONContent {
  const targetType = pick(TARGET_TYPES)
  const ids = pool[`${targetType}s` as keyof Pool]
  const targetId = ids.length ? pick(ids) : randomUUID()
  return {
    type: 'mention',
    attrs: { targetType, targetId, label: `${targetType}-${targetId.slice(0, 6)}` }
  }
}

function genDoc(pool: Pool, paragraphs: number, mentionsPerParagraph: number): JSONContent {
  const content: JSONContent[] = []
  for (let p = 0; p < paragraphs; p++) {
    const inline: JSONContent[] = []
    const m = mentionsPerParagraph > 0 ? rand(mentionsPerParagraph + 1) : 0
    for (let i = 0; i <= m; i++) {
      inline.push({ type: 'text', text: sentence(6 + rand(20)) + ' ' })
      if (i < m) inline.push(mentionNode(pool))
    }
    content.push({ type: 'paragraph', content: inline })
    if (p % 7 === 3) {
      content.push({
        type: 'bulletList',
        content: [1, 2].map(() => ({
          type: 'listItem',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: sentence(8) }, mentionNode(pool)] }
          ]
        }))
      })
    }
  }
  return { type: 'doc', content }
}

// ---------------------------------------------------------------------------
// Stats helpers
// ---------------------------------------------------------------------------
function pct(xs: number[], p: number): number {
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]
}
function summarize(label: string, xs: number[]): void {
  const sum = xs.reduce((a, b) => a + b, 0)
  console.log(
    `${label.padEnd(44)} n=${xs.length.toString().padStart(6)}  p50=${pct(xs, 50).toFixed(3)}ms  p95=${pct(xs, 95).toFixed(3)}ms  p99=${pct(xs, 99).toFixed(3)}ms  max=${Math.max(...xs).toFixed(2)}ms  mean=${(sum / xs.length).toFixed(3)}ms`
  )
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  const src = process.argv[2]
  if (!src) throw new Error('usage: spike <birdbrain.db>')
  const dir = mkdtempSync(join(tmpdir(), 'spike-388-'))
  const dbPath = join(dir, 'birdbrain.db')
  copyFileSync(src, dbPath)
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  console.log(`db copy: ${dbPath}  user_version=${db.pragma('user_version', { simple: true })}`)

  // Candidate index. No FK to target tables on purpose: a deleted target must
  // stay representable as a broken reference (#389 AC), and an FK cascade
  // would silently erase it. FK to notes only.
  db.exec(`
    CREATE TABLE IF NOT EXISTS note_references (
      note_id TEXT NOT NULL,
      case_id TEXT NOT NULL,
      ord INTEGER NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      PRIMARY KEY (note_id, ord),
      FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_note_references_target ON note_references(case_id, target_type, target_id);
    CREATE INDEX IF NOT EXISTS idx_note_references_note ON note_references(note_id);
  `)

  // Pick the case with the most captures as the host.
  const host = db
    .prepare('SELECT case_id, COUNT(*) n FROM captures GROUP BY case_id ORDER BY n DESC LIMIT 1')
    .get() as { case_id: string; n: number }
  const otherCase = db.prepare('SELECT id FROM cases WHERE id != ? LIMIT 1').get(host.case_id) as
    { id: string } | undefined
  const pool: Pool = {
    captures: (
      db.prepare('SELECT id FROM captures WHERE case_id = ?').all(host.case_id) as { id: string }[]
    ).map((r) => r.id),
    selectors: (
      db.prepare('SELECT id FROM selectors WHERE case_id = ?').all(host.case_id) as { id: string }[]
    ).map((r) => r.id),
    tags: (db.prepare('SELECT id FROM tags').all() as { id: string }[]).map((r) => r.id),
    notes: (
      db.prepare('SELECT id FROM notes WHERE case_id = ?').all(host.case_id) as { id: string }[]
    ).map((r) => r.id)
  }
  console.log(
    `host case ${host.case_id}: captures=${pool.captures.length} selectors=${pool.selectors.length} tags=${pool.tags.length} notes=${pool.notes.length}${otherCase ? ` otherCase=${otherCase.id}` : ''}`
  )

  // Real rich notes: does the extended schema still accept every existing doc?
  const realDocs = db
    .prepare('SELECT id, body_doc FROM notes WHERE body_doc IS NOT NULL')
    .all() as { id: string; body_doc: string }[]
  let realOk = 0
  for (const r of realDocs) {
    PMNode.fromJSON(schema(), JSON.parse(r.body_doc)).check()
    realOk++
  }
  console.log(`existing rich notes validate under extended schema: ${realOk}/${realDocs.length}`)

  const insertNote = db.prepare(
    `INSERT INTO notes (id, case_id, capture_id, title, body, body_doc, created_at, updated_at) VALUES (?, ?, NULL, ?, ?, ?, ?, ?)`
  )
  const updateNote = db.prepare(
    `UPDATE notes SET body = ?, body_doc = ?, updated_at = ? WHERE id = ?`
  )
  const delRefs = db.prepare('DELETE FROM note_references WHERE note_id = ?')
  const insRef = db.prepare(
    'INSERT INTO note_references (note_id, case_id, ord, target_type, target_id) VALUES (?, ?, ?, ?, ?)'
  )
  // Case-membership check, batched: one statement per target type per save.
  const captureCase = db.prepare(
    'SELECT id, case_id FROM captures WHERE id IN (SELECT value FROM json_each(?))'
  )
  const selectorCase = db.prepare(
    'SELECT id, case_id FROM selectors WHERE id IN (SELECT value FROM json_each(?))'
  )
  const noteCase = db.prepare(
    'SELECT id, case_id FROM notes WHERE id IN (SELECT value FROM json_each(?))'
  )

  function assertRefsInCase(refs: Ref[], caseId: string, selfNoteId: string): void {
    const by = (t: TargetType): string[] =>
      refs.filter((r) => r.targetType === t).map((r) => r.targetId)
    const checks: Array<[TargetType, Database.Statement]> = [
      ['capture', captureCase],
      ['selector', selectorCase],
      ['note', noteCase]
    ]
    for (const [t, stmt] of checks) {
      const ids = by(t)
      if (!ids.length) continue
      const rows = stmt.all(JSON.stringify(ids)) as { id: string; case_id: string }[]
      for (const row of rows) {
        if (row.case_id !== caseId)
          throw new Error(`mention: ${t} ${row.id} belongs to another case`)
      }
    }
    if (refs.some((r) => r.targetType === 'note' && r.targetId === selfNoteId)) {
      // Self-mention: allowed structurally; flagged here just to count it.
    }
    // Tags are global (no case_id column) — nothing to check.
  }

  // The full save path a repo would run, timed in phases.
  const t = {
    parse: [] as number[],
    check: [] as number[],
    extractJson: [] as number[],
    extractPm: [] as number[],
    text: [] as number[],
    caseCheck: [] as number[],
    write: [] as number[],
    total: [] as number[]
  }
  const saveTx = db.transaction((noteId: string, caseId: string, json: string, isNew: boolean) => {
    const t0 = performance.now()
    const parsed = JSON.parse(json) as JSONContent
    const t1 = performance.now()
    const pm = PMNode.fromJSON(schema(), parsed)
    pm.check()
    const t2 = performance.now()
    const refsJ = extractFromJson(parsed)
    const t3 = performance.now()
    const refsP = extractFromPm(pm)
    const t4 = performance.now()
    if (refsJ.length !== refsP.length) throw new Error('extractor disagreement')
    validateRefs(refsJ)
    const text = generateText(parsed, extensions, { blockSeparator: '\n' }).trim()
    const t5 = performance.now()
    assertRefsInCase(refsJ, caseId, noteId)
    const t6 = performance.now()
    const now = new Date().toISOString()
    if (isNew) insertNote.run(noteId, caseId, 'spike', text, JSON.stringify(parsed), now, now)
    else updateNote.run(text, JSON.stringify(parsed), now, noteId)
    delRefs.run(noteId)
    for (const r of refsJ) insRef.run(noteId, caseId, r.ord, r.targetType, r.targetId)
    const t7 = performance.now()
    t.parse.push(t1 - t0)
    t.check.push(t2 - t1)
    t.extractJson.push(t3 - t2)
    t.extractPm.push(t4 - t3)
    t.text.push(t5 - t4)
    t.caseCheck.push(t6 - t5)
    t.write.push(t7 - t6)
    t.total.push(t7 - t0)
    return refsJ.length
  })

  // --- Phase 1: 5,000 typical notes -------------------------------------
  const N = 5000
  console.log(`\n=== Phase 1: ${N} typical notes (1-6 paragraphs, 0-4 mentions each) ===`)
  let refsTotal = 0
  const bytes: number[] = []
  for (let i = 0; i < N; i++) {
    const id = randomUUID()
    const doc = genDoc(pool, 1 + rand(6), 4)
    const json = JSON.stringify(doc)
    bytes.push(json.length)
    refsTotal += saveTx(id, host.case_id, json, true)
    pool.notes.push(id)
  }
  console.log(
    `inserted ${N} notes, ${refsTotal} references, doc bytes p50=${pct(bytes, 50)} p95=${pct(bytes, 95)} max=${Math.max(...bytes)}`
  )
  for (const [k, v] of Object.entries(t)) summarize(`  ${k}`, v)

  // --- Phase 2: edits (update path) --------------------------------------
  for (const k of Object.keys(t)) (t as Record<string, number[]>)[k] = []
  console.log(`\n=== Phase 2: 2,000 re-saves of existing notes (autosave pattern) ===`)
  for (let i = 0; i < 2000; i++) {
    const id = pick(pool.notes)
    saveTx(id, host.case_id, JSON.stringify(genDoc(pool, 1 + rand(6), 4)), false)
  }
  for (const [k, v] of Object.entries(t)) summarize(`  ${k}`, v)

  // --- Phase 3: big documents ------------------------------------------------
  console.log(`\n=== Phase 3: large documents ===`)
  for (const [paras, mpp] of [
    [50, 4],
    [200, 4],
    [500, 6],
    [1000, 10]
  ] as const) {
    for (const k of Object.keys(t)) (t as Record<string, number[]>)[k] = []
    const doc = genDoc(pool, paras, mpp)
    const json = JSON.stringify(doc)
    const id = randomUUID()
    const n = saveTx(id, host.case_id, json, true)
    for (let i = 0; i < 4; i++) saveTx(id, host.case_id, json, false)
    console.log(`  ${paras} paragraphs, ${(json.length / 1024).toFixed(0)} KB, ${n} mentions:`)
    for (const [k, v] of Object.entries(t)) summarize(`    ${k}`, v)
  }

  // --- Phase 4: queries --------------------------------------------------------
  console.log(
    `\n=== Phase 4: read queries over ${db.prepare('SELECT COUNT(*) c FROM note_references').get()!['c' as never]} references ===`
  )
  const backlinks = db.prepare(
    `SELECT r.note_id, n.title, n.updated_at FROM note_references r JOIN notes n ON n.id = r.note_id
     WHERE r.case_id = ? AND r.target_type = ? AND r.target_id = ? GROUP BY r.note_id ORDER BY n.updated_at DESC`
  )
  const outgoing = db.prepare(
    `SELECT r.ord, r.target_type, r.target_id,
       CASE r.target_type
         WHEN 'capture' THEN (SELECT 1 FROM captures c WHERE c.id = r.target_id)
         WHEN 'selector' THEN (SELECT 1 FROM selectors s WHERE s.id = r.target_id)
         WHEN 'tag' THEN (SELECT 1 FROM tags t WHERE t.id = r.target_id)
         WHEN 'note' THEN (SELECT 1 FROM notes n WHERE n.id = r.target_id)
       END AS resolves
     FROM note_references r WHERE r.note_id = ? ORDER BY r.ord`
  )
  const backlinkCounts = db.prepare(
    `SELECT target_type, target_id, COUNT(DISTINCT note_id) c FROM note_references WHERE case_id = ? GROUP BY target_type, target_id`
  )
  const qb: number[] = []
  for (let i = 0; i < 2000; i++) {
    const t0 = performance.now()
    backlinks.all(host.case_id, 'capture', pick(pool.captures))
    qb.push(performance.now() - t0)
  }
  summarize('  backlinks(capture)', qb)
  const qn: number[] = []
  for (let i = 0; i < 2000; i++) {
    const t0 = performance.now()
    backlinks.all(host.case_id, 'note', pick(pool.notes))
    qn.push(performance.now() - t0)
  }
  summarize('  backlinks(note)', qn)
  const qo: number[] = []
  let broken = 0
  for (let i = 0; i < 2000; i++) {
    const t0 = performance.now()
    const rows = outgoing.all(pick(pool.notes)) as { resolves: number | null }[]
    qo.push(performance.now() - t0)
    broken += rows.filter((r) => r.resolves == null).length
  }
  summarize('  outgoing refs + resolve status', qo)
  console.log(`  broken references seen in sample: ${broken}`)
  const t0 = performance.now()
  const counts = backlinkCounts.all(host.case_id)
  console.log(
    `  backlink-count map for whole case: ${counts.length} targets in ${(performance.now() - t0).toFixed(2)}ms`
  )

  // --- Phase 5: failure modes ------------------------------------------------
  console.log(`\n=== Phase 5: failure modes ===`)
  const attempt = (label: string, fn: () => void): void => {
    try {
      fn()
      console.log(`  ${label.padEnd(58)} -> ACCEPTED`)
    } catch (e) {
      console.log(`  ${label.padEnd(58)} -> REJECTED: ${(e as Error).message.slice(0, 90)}`)
    }
  }
  const mk = (attrs: Record<string, unknown>): string =>
    JSON.stringify({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'mention', attrs }] }]
    })
  attempt('mention with no attrs (PM check only)', () =>
    PMNode.fromJSON(schema(), JSON.parse(mk({}))).check()
  )
  attempt('mention with no attrs (full save path)', () =>
    saveTx(randomUUID(), host.case_id, mk({}), true)
  )
  attempt('mention targetType=bogus', () =>
    saveTx(randomUUID(), host.case_id, mk({ targetType: 'bogus', targetId: 'x' }), true)
  )
  attempt('mention targetId=number', () =>
    saveTx(randomUUID(), host.case_id, mk({ targetType: 'capture', targetId: 42 }), true)
  )
  attempt('mention at block level (doc > mention)', () =>
    saveTx(
      randomUUID(),
      host.case_id,
      JSON.stringify({
        type: 'doc',
        content: [{ type: 'mention', attrs: { targetType: 'tag', targetId: 'x' } }]
      }),
      true
    )
  )
  attempt('mention to non-existent capture (dangling)', () =>
    saveTx(
      randomUUID(),
      host.case_id,
      mk({ targetType: 'capture', targetId: randomUUID(), label: 'gone' }),
      true
    )
  )
  if (otherCase) {
    const foreign = db
      .prepare('SELECT id FROM captures WHERE case_id = ? LIMIT 1')
      .get(otherCase.id) as { id: string } | undefined
    if (foreign)
      attempt('mention to capture in ANOTHER case', () =>
        saveTx(
          randomUUID(),
          host.case_id,
          mk({ targetType: 'capture', targetId: foreign.id }),
          true
        )
      )
    const foreignNote = db
      .prepare('SELECT id FROM notes WHERE case_id = ? LIMIT 1')
      .get(otherCase.id) as { id: string } | undefined
    if (foreignNote)
      attempt('mention to note in ANOTHER case', () =>
        saveTx(
          randomUUID(),
          host.case_id,
          mk({ targetType: 'note', targetId: foreignNote.id }),
          true
        )
      )
  }
  const selfId = randomUUID()
  attempt('note mentioning itself', () =>
    saveTx(selfId, host.case_id, mk({ targetType: 'note', targetId: selfId }), true)
  )
  attempt('mention to a global tag', () =>
    saveTx(
      randomUUID(),
      host.case_id,
      mk({ targetType: 'tag', targetId: pool.tags[0] ?? randomUUID() }),
      true
    )
  )
  attempt('unknown node type (renderer newer than main)', () =>
    saveTx(
      randomUUID(),
      host.case_id,
      JSON.stringify({
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'futureNode', attrs: {} }] }]
      }),
      true
    )
  )
  // Delete-target behaviour: reference must survive as broken.
  const victim = randomUUID()
  const referrer = randomUUID()
  db.prepare(
    `INSERT INTO notes (id, case_id, title, body, created_at, updated_at) VALUES (?, ?, 'victim', '', '', '')`
  ).run(victim, host.case_id)
  saveTx(
    referrer,
    host.case_id,
    mk({ targetType: 'note', targetId: victim, label: 'victim' }),
    true
  )
  db.prepare('DELETE FROM notes WHERE id = ?').run(victim)
  const after = outgoing.all(referrer) as { resolves: number | null }[]
  console.log(
    `  delete mentioned note -> referrer still has ${after.length} ref(s), resolves=${after[0]?.resolves ?? 'null (broken)'}`
  )
  db.prepare('DELETE FROM notes WHERE id = ?').run(referrer)
  console.log(
    `  delete referring note -> its refs remaining: ${(db.prepare('SELECT COUNT(*) c FROM note_references WHERE note_id = ?').get(referrer) as { c: number }).c}`
  )
  // Transaction atomicity: a rejected save leaves neither note nor refs.
  const atomicId = randomUUID()
  saveTx(atomicId, host.case_id, mk({ targetType: 'tag', targetId: 'ok' }), true)
  try {
    saveTx(atomicId, host.case_id, mk({ targetType: 'bogus', targetId: 'x' }), false)
  } catch {
    /* expected */
  }
  const still = db
    .prepare('SELECT target_type FROM note_references WHERE note_id = ?')
    .all(atomicId) as { target_type: string }[]
  console.log(
    `  rejected re-save rolls back -> refs after: ${JSON.stringify(still.map((r) => r.target_type))} (expect ["tag"])`
  )
  // Plain-text derivation for FTS
  console.log(
    `  renderText sample: ${JSON.stringify(generateText(JSON.parse(mk({ targetType: 'capture', targetId: 'abc', label: 'example.com/post' })), extensions))}`
  )

  // --- Phase 6: rebuild-from-scratch cost (migration / repair path) -----------
  console.log(
    `\n=== Phase 6: full re-extraction of every note in the case (repair/migration path) ===`
  )
  const all = db
    .prepare('SELECT id, body_doc FROM notes WHERE case_id = ? AND body_doc IS NOT NULL')
    .all(host.case_id) as { id: string; body_doc: string }[]
  const t6 = performance.now()
  db.transaction(() => {
    db.prepare('DELETE FROM note_references WHERE case_id = ?').run(host.case_id)
    for (const n of all) {
      const refs = extractFromJson(JSON.parse(n.body_doc))
      for (const r of refs) insRef.run(n.id, host.case_id, r.ord, r.targetType, r.targetId)
    }
  })()
  console.log(`  ${all.length} notes re-extracted in ${(performance.now() - t6).toFixed(0)}ms`)

  console.log(
    `\ndb size after: ${((db.prepare('SELECT page_count * page_size AS b FROM pragma_page_count(), pragma_page_size()').get() as { b: number }).b / 1024) | 0} KB`
  )
  db.close()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
