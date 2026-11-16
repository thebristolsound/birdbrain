import { describe, it, expect } from 'vitest'
import { MANIFEST_SCHEMA_VERSION } from '@shared/constants'
import {
  FIELD_RULES,
  MIN_READER_SCHEMA_VERSION,
  carriedFieldCount,
  earliestSchemaVersion,
  minReaderSchemaVersion,
  readerGate
} from '@shared/manifestEntryRules'
import type { FieldRule, ManifestEntryType } from '@shared/manifestEntryRules'
import { MANIFEST_ENTRY_TYPES, ManifestEntrySchema } from '@shared/schemas'
import { ENGINE_INVENTORY } from '../helpers/captureEnginePackage'

// The rules module is what the writer's stamp and the reader's schema both
// read, so these tests go through its interface and assert the two halves of
// each rule against each other. What an entry written by the app stamps, and
// what the schema says to it, is pinned in
// tests/shared/verify/manifestEntryKnownAnswers.test.ts.

const TYPES = Object.keys(MIN_READER_SCHEMA_VERSION) as ManifestEntryType[]

const RULES = Object.entries(FIELD_RULES).flatMap(([type, rules]) =>
  Object.entries<FieldRule>(rules).map(([name, rule]) => ({
    type: type as ManifestEntryType,
    name,
    rule
  }))
)

// Every refusal the reader gives for a field under too low a stamp, written
// out: a verifier in a recipient's hands prints these.
const REFUSALS: Record<string, string> = {
  'capture.exhibitNumber': '`exhibitNumber` on a capture entry requires schemaVersion 3',
  'capture.egress': 'the Egress fields on a capture entry require schemaVersion 5',
  'capture.captureEngine': 'the capture engine fields on a capture entry require schemaVersion 6',
  'capture.linkProvenance': 'the link provenance fields on a capture entry require schemaVersion 6',
  'capture.launchedBrowser':
    'the launched browser values on a capture entry require schemaVersion 7',
  'capture.persona': 'the Persona fields require schemaVersion 7',
  'timestamp.subject': '`subject` requires schemaVersion 4',
  'exhibit.memberCode': '`memberCode` requires schemaVersion 4',
  'exhibit.persona': 'the Persona fields require schemaVersion 7'
}

// The first slice's inventory with both optional files absent for a schema-6
// reason, so it carries no schema-7 value.
const ABSENT = { present: false, reason: 'not-taken' } as const
function inventory(parts: object = {}): unknown {
  return { ...ENGINE_INVENTORY, transactionRecord: ABSENT, pdf: ABSENT, ...parts }
}

// A value for a field under test. A rule reads presence alone, except for the
// inventory, whose values the launched browser rule reads.
function carried(field: string): unknown {
  return field === 'inventory' ? inventory() : 'carried'
}

function shapeKeys(type: ManifestEntryType): string[] {
  const option = ManifestEntrySchema.options.find(({ shape }) => shape.type.value === type)
  return Object.keys(option?.shape ?? {})
}

describe('Manifest Entry rules: the entry types', () => {
  it('has a minimum for every entry type the schema reads, and for no other', () => {
    expect([...TYPES].sort()).toEqual([...MANIFEST_ENTRY_TYPES].sort())
  })

  it('pins each type at the schema that added it', () => {
    expect(MIN_READER_SCHEMA_VERSION).toEqual({
      capture: 2,
      deletion: 2,
      timestamp: 2,
      export: 2,
      'archive-export': 2,
      import: 2,
      exhibit: 3,
      derivation: 3,
      renumber: 3,
      merge: 4,
      'member-add': 4,
      'member-revoke': 4,
      exclude: 4
    })
  })

  it.each(TYPES)('%s: never asks for a reader this build is not', (type) => {
    expect(MIN_READER_SCHEMA_VERSION[type]).toBeLessThanOrEqual(MANIFEST_SCHEMA_VERSION)
  })

  it.each(TYPES)('%s: reads from the version it is written at, or the unsigned form', (type) => {
    const unsigned = type === 'capture' || type === 'deletion'
    expect(earliestSchemaVersion(type)).toBe(unsigned ? 1 : MIN_READER_SCHEMA_VERSION[type])
    // The writer never stamps below what the reader admits.
    expect(minReaderSchemaVersion({ type })).toBe(MIN_READER_SCHEMA_VERSION[type])
    expect(minReaderSchemaVersion({ type })).toBeGreaterThanOrEqual(earliestSchemaVersion(type))
  })
})

describe('Manifest Entry rules: the field rules', () => {
  it('has a written refusal for every rule', () => {
    expect(RULES.map(({ type, name }) => `${type}.${name}`).sort()).toEqual(
      Object.keys(REFUSALS).sort()
    )
  })

  describe.each(RULES)('$type: $name', ({ type, name, rule }) => {
    const [check, issue] = readerGate(rule)

    it('raises the type minimum and stays within what this build reads', () => {
      expect(rule.minReader).toBeGreaterThan(MIN_READER_SCHEMA_VERSION[type])
      expect(rule.minReader).toBeLessThanOrEqual(MANIFEST_SCHEMA_VERSION)
    })

    it('names only fields the entry schema has', () => {
      // A misspelt field is one no entry carries, so its rule would never fire.
      expect(rule.fields.length).toBeGreaterThan(0)
      for (const field of rule.fields) expect(shapeKeys(type), field).toContain(field)
    })

    it('refuses with its written message, at schemaVersion', () => {
      expect(issue).toEqual({ message: REFUSALS[`${type}.${name}`], path: ['schemaVersion'] })
    })

    it.each(rule.fields)('stamps and gates %s at the same version', (field) => {
      const entry = { type, [field]: carried(field) }
      // The writer's half.
      expect(minReaderSchemaVersion(entry)).toBe(rule.minReader)
      // The reader's half: refused one below the stamp, admitted at it.
      expect(check({ ...entry, schemaVersion: rule.minReader - 1 })).toBe(false)
      expect(check({ ...entry, schemaVersion: rule.minReader })).toBe(true)
      expect(check({ ...entry, schemaVersion: MANIFEST_SCHEMA_VERSION })).toBe(true)
    })

    it('leaves an entry without its fields at the type minimum, at any version', () => {
      const absent = Object.fromEntries(rule.fields.map((field) => [field, undefined]))
      expect(minReaderSchemaVersion({ type, ...absent })).toBe(MIN_READER_SCHEMA_VERSION[type])
      expect(check({ type, ...absent, schemaVersion: 0 })).toBe(true)
    })
  })

  it('stamps the highest of the rules an entry invokes', () => {
    const capture = (fields: Record<string, unknown>): number =>
      minReaderSchemaVersion({ type: 'capture', ...fields })
    expect(capture({ exhibitNumber: 7, egressKind: 'proxy' })).toBe(5)
    expect(capture({ egressKind: 'proxy', linkHref: 'http://example.com/' })).toBe(6)
    expect(capture({ exhibitNumber: 7, boundTlsAbsent: 'not-https', personaId: 'p-1' })).toBe(7)
    expect(minReaderSchemaVersion({ type: 'exhibit', memberCode: 'AB', personaId: 'p-1' })).toBe(7)
  })

  it('reads no rule of another entry type', () => {
    // `exhibitNumber` is a rule on `capture` only: every `exhibit` carries one.
    expect(minReaderSchemaVersion({ type: 'exhibit', exhibitNumber: 7 })).toBe(3)
    expect(minReaderSchemaVersion({ type: 'deletion', subject: 'entry' })).toBe(2)
    expect(minReaderSchemaVersion({ type: 'timestamp', memberCode: 'AB' })).toBe(2)
  })

  it('counts the fields of a rule an entry carries', () => {
    const { linkProvenance } = FIELD_RULES.capture
    expect(carriedFieldCount(linkProvenance, {})).toBe(0)
    expect(carriedFieldCount(linkProvenance, { linkHref: 'http://example.com/' })).toBe(1)
    expect(
      carriedFieldCount(linkProvenance, {
        linkedFromCaptureId: 'c-1',
        linkedFromContentHash: '5'.repeat(64),
        linkHref: 'http://example.com/',
        egressKind: 'proxy'
      })
    ).toBe(3)
  })
})

describe('Manifest Entry rules: the launched browser values', () => {
  const { launchedBrowser } = FIELD_RULES.capture
  const [check] = readerGate(launchedBrowser)
  const record = (members: object): unknown =>
    inventory({ transactionRecord: { ...ENGINE_INVENTORY.transactionRecord, ...members } })

  // A value on a field schema-6 readers already have: no field's presence
  // says it, so the rule reads the value.
  const schema7: Array<[string, Record<string, unknown>]> = [
    ['method launched', { method: 'launched' }],
    ['method launched-passive', { method: 'launched-passive' }],
    [
      'a Transaction Record absent because the page was not recorded',
      {
        inventory: inventory({ transactionRecord: { present: false, reason: 'page-not-recorded' } })
      }
    ],
    [
      'a Transaction Record absent after a back-forward cache restore',
      {
        inventory: inventory({
          transactionRecord: { present: false, reason: 'back-forward-cache' }
        })
      }
    ],
    [
      'a PDF a passive Capture did not take',
      { inventory: inventory({ pdf: { present: false, reason: 'not-taken-passive' } }) }
    ],
    ['servedByServiceWorker', { inventory: record({ servedByServiceWorker: 0 }) }],
    ['requestBodiesWithheld', { inventory: record({ requestBodiesWithheld: 0 }) }],
    ['httpCacheDisabled', { inventory: record({ httpCacheDisabled: true }) }]
  ]

  it.each(schema7)('stamps and gates %s at 7', (_name, fields) => {
    const entry = { type: 'capture' as const, ...fields }
    expect(minReaderSchemaVersion(entry)).toBe(7)
    expect(check({ ...entry, schemaVersion: 6 })).toBe(false)
    expect(check({ ...entry, schemaVersion: 7 })).toBe(true)
  })

  const earlier: Array<[string, Record<string, unknown>, number]> = [
    ['method extension', { method: 'extension' }, 2],
    ['method background', { method: 'background' }, 2],
    ['method duplicate', { method: 'duplicate' }, 2],
    ['a schema-6 inventory with both files absent', { inventory: inventory() }, 6],
    [
      'a schema-6 inventory with a failed PDF',
      { inventory: inventory({ pdf: { present: false, reason: 'failed' } }) },
      6
    ],
    ['a schema-6 inventory with a Transaction Record', { inventory: record({}) }, 6]
  ]

  it.each(earlier)('leaves %s below 7', (_name, fields, stamp) => {
    const entry = { type: 'capture' as const, ...fields }
    expect(minReaderSchemaVersion(entry)).toBe(stamp)
    expect(check({ ...entry, schemaVersion: stamp })).toBe(true)
  })
})
