import { INVENTORY_ABSENCE_REASONS, LAUNCHED_CAPTURE_METHODS } from '@shared/types'
import type { CaptureInventory } from '@shared/schemas'

// Which schema version a reader needs for each Manifest Entry, stated once.
//
// Two sides read it. The writer (`appendManifestEntry` in manifest.ts) stamps
// the answer on the entry as its `schemaVersion`. The reader
// (`ManifestEntrySchema` in schemas.ts) refuses an entry stamped below it. A
// writer that stamps below what the reader demands writes a chain its own
// verifier calls broken; a reader that demands less than the fields need lets
// an older verifier meet a field its strict shape lacks and report a broken
// chain where it should say "verifier too old" (X25). Both take each version
// and each field name from this file. What the file cannot do is put a rule
// into the reader: the schema applies one only where it has a refine built by
// `readerGate`, and tests/shared/manifestEntryRules.test.ts fails for a rule
// without one.
//
// The shell verifier (verifyScript.ts) and the Verify Runbook do not read it,
// on purpose: ADR-0004 has them check through a path independent of this code.

// The MINIMUM schema version a reader needs for each entry type this build
// writes: not MANIFEST_SCHEMA_VERSION, which is the highest version this build
// can READ.
//
// Stamping the read ceiling on every entry would make every capture written
// after a version bump unreadable to verifiers already in recipients' hands,
// for entries whose shape those verifiers understand perfectly (X25: a stale
// verifier reporting a valid chain as broken is a false accusation, and nothing
// can recall a distributed copy). So each type declares the oldest verifier
// that can read it, and an entry is stamped higher only when it carries a
// field or value a later schema added (FIELD_RULES).
//
// Every entry type has a key here: the writer indexes it by the type it is
// about to write and the reader by the type whose schema it declares, so
// adding a type without deciding its minimum is a compile error, not a silent
// 2. That no value exceeds what this build can read is pinned by a test rather
// than a runtime guard: an unreachable throw here would be untestable code on
// the evidence path.
//
// A value here is also the lowest version the reader admits for the type
// (earliestSchemaVersion; the two types with an unsigned form are admitted
// from 1), and a rule's `minReader` the lowest it admits for the rule's
// fields. So neither ever goes up once an entry has been written under it:
// the reader would refuse such entries already in a chain, or, for those two
// types, every new entry would lock out verifiers that read the type today.
// To stamp later entries higher, add a rule for what is new in them, or pass
// `minReaderSchemaVersion` to the append.
export const MIN_READER_SCHEMA_VERSION = {
  capture: 2,
  deletion: 2,
  // Pinned at 2 by the reader as well, so each MUST carry a signature
  // (verify-core enforces signatures from 2 up).
  timestamp: 2,
  export: 2,
  'archive-export': 2,
  import: 2,
  // The v3 types (ADR-0023). No v1 or v2 form exists for either, so a reader
  // below 3 cannot make sense of one and stamping anything lower would invite
  // it to try.
  exhibit: 3,
  derivation: 3,
  renumber: 3,
  // The Shared Case types are schema 4 (#1509); `merge` is the one the sync
  // session writes (#1512), the other three the Owner's roster writers
  // (#1810). A 4 is what the 1.0.1-beta.22 verifier reads.
  merge: 4,
  'member-add': 4,
  'member-revoke': 4,
  exclude: 4
} satisfies Record<string, number>

export type ManifestEntryType = keyof typeof MIN_READER_SCHEMA_VERSION

// The two types written before entries were signed. The reader still admits
// their unsigned schema-1 form, which this build never writes: a legacy chain
// must keep verifying.
const UNSIGNED_SCHEMA_VERSION = 1
const TYPES_WITH_AN_UNSIGNED_FORM: ReadonlySet<ManifestEntryType> = new Set(['capture', 'deletion'])

// The lowest `schemaVersion` the reader admits on an entry of this type: the
// writer's minimum, except for the two types with an unsigned form.
export function earliestSchemaVersion(type: ManifestEntryType): number {
  return TYPES_WITH_AN_UNSIGNED_FORM.has(type)
    ? UNSIGNED_SCHEMA_VERSION
    : MIN_READER_SCHEMA_VERSION[type]
}

// What a rule reads from an entry: any field by name, and the two fields the
// launched browser rule reads by value.
export type RuleSubject = { readonly [field: string]: unknown } & {
  readonly method?: string
  readonly inventory?: CaptureInventory
}

// One "these need reader schema N" rule. An older reader's strict shape has
// none of `fields`, so it meets an entry carrying one as "verifier too old"
// only under a stamp of `minReader`.
export interface FieldRule<Field extends string = string> {
  readonly minReader: number
  // An entry carrying any of these invokes the rule.
  readonly fields: readonly Field[]
  // A value that invokes it on a field older readers already have.
  readonly carriesValue?: (entry: RuleSubject) => boolean
  // What the reader's refusal names, completed by `schemaVersion <minReader>`.
  readonly refusal: string
}

function rule<const Field extends string>(fieldRule: FieldRule<Field>): FieldRule<Field> {
  return fieldRule
}

const SCHEMA_6_ABSENCE_REASONS: ReadonlySet<string> = new Set(INVENTORY_ABSENCE_REASONS)
const LAUNCHED_METHODS: ReadonlySet<string> = new Set(LAUNCHED_CAPTURE_METHODS)

// The schema-7 launched browser values that are not fields of their own: a
// launched Capture Method, or a stage-2 inventory value (a reason outside the
// schema-6 pair, or a schema-7 member of the present Transaction Record part).
// The method values are the first values, rather than fields, a rule reads: a
// schema-6 verifier's strict method enum has neither.
function carriesLaunchedBrowserValue({ method, inventory }: RuleSubject): boolean {
  if (method !== undefined && LAUNCHED_METHODS.has(method)) return true
  if (inventory === undefined) return false
  const { transactionRecord, pdf } = inventory
  if (!pdf.present && !SCHEMA_6_ABSENCE_REASONS.has(pdf.reason)) return true
  if (!transactionRecord.present) return !SCHEMA_6_ABSENCE_REASONS.has(transactionRecord.reason)
  const { servedByServiceWorker, requestBodiesWithheld, httpCacheDisabled } = transactionRecord
  return [servedByServiceWorker, requestBodiesWithheld, httpCacheDisabled].some(
    (member) => member !== undefined
  )
}

// The Persona fields are schema 7 on `capture` and `exhibit` entries alike
// (ADR-0030, amended 2026-10-31).
const PERSONA = rule({
  minReader: 7,
  fields: ['personaId', 'personaLabel'],
  refusal: 'the Persona fields require'
})

// The fields and values a later schema added to an entry type, where the
// entry itself shows them. What an entry cannot show, such as a `timestamp`
// or `deletion` that binds an Exhibit which is not a Capture (schema 3), the
// caller says with `minReaderSchemaVersion` on the append (AppendOptions in
// manifest.ts). A type with no key here has no rule.
export const FIELD_RULES = {
  capture: {
    // X46. A `capture` entry's shape has a schema-2 form, so the type's
    // minimum says 2 and the field raises it.
    exhibitNumber: rule({
      minReader: 3,
      fields: ['exhibitNumber'],
      refusal: '`exhibitNumber` on a capture entry requires'
    }),
    // ADR-0032.
    egress: rule({
      minReader: 5,
      fields: ['egressKind', 'egressLabel', 'userAgent', 'tlsSkipped'],
      refusal: 'the Egress fields on a capture entry require'
    }),
    captureEngine: rule({
      minReader: 6,
      fields: [
        'inventory',
        'scrollToLoad',
        'transactionRecordHash',
        'boundTls',
        'boundTlsAbsent',
        'pdfHash'
      ],
      refusal: 'the capture engine fields on a capture entry require'
    }),
    // ADR-0040, "The fields need schema 6".
    linkProvenance: rule({
      minReader: 6,
      fields: ['linkedFromCaptureId', 'linkedFromContentHash', 'linkHref'],
      refusal: 'the link provenance fields on a capture entry require'
    }),
    // The launched browser's fields, its two Capture Methods and the stage-2
    // inventory values.
    launchedBrowser: rule({
      minReader: 7,
      fields: ['browserProduct', 'browserVersion', 'browserFamily', 'passiveRule'],
      carriesValue: carriesLaunchedBrowserValue,
      refusal: 'the launched browser values on a capture entry require'
    }),
    persona: PERSONA
  },
  timestamp: {
    // #1518: what the stamped hash is.
    subject: rule({ minReader: 4, fields: ['subject'], refusal: '`subject` requires' })
  },
  exhibit: {
    // #1509: an entry carrying it stamps 4 and one without it keeps the type's 3.
    memberCode: rule({ minReader: 4, fields: ['memberCode'], refusal: '`memberCode` requires' }),
    persona: PERSONA
  }
} satisfies Partial<Record<ManifestEntryType, Record<string, FieldRule>>>

// How many of a rule's fields the entry carries. A field is carried when it
// is present, whatever its value: these are omit-when-absent fields.
export function carriedFieldCount(fieldRule: FieldRule, entry: RuleSubject): number {
  return fieldRule.fields.filter((field) => entry[field] !== undefined).length
}

function invokes(fieldRule: FieldRule, entry: RuleSubject): boolean {
  return carriedFieldCount(fieldRule, entry) > 0 || fieldRule.carriesValue?.(entry) === true
}

const RULES_BY_TYPE: Partial<Record<ManifestEntryType, Record<string, FieldRule>>> = FIELD_RULES

// The writer's half: the lowest schema version a reader needs for this entry,
// which is the highest of its type's minimum and the rules it invokes.
// Decided here from the entry itself rather than by each caller, so every
// append of a field stamps what the reader demands for it.
export function minReaderSchemaVersion(
  entry: RuleSubject & { readonly type: ManifestEntryType }
): number {
  const invoked = Object.values(RULES_BY_TYPE[entry.type] ?? {}).filter((fieldRule) =>
    invokes(fieldRule, entry)
  )
  return Math.max(
    MIN_READER_SCHEMA_VERSION[entry.type],
    ...invoked.map(({ minReader }) => minReader)
  )
}

type ReaderGate = [
  check: (entry: RuleSubject & { readonly schemaVersion: number }) => boolean,
  issue: { message: string; path: string[] }
]

// The reader's half of one rule, as the two arguments of a Zod `.refine`: an
// entry that invokes the rule under a lower stamp is refused, at
// `schemaVersion`.
export function readerGate(fieldRule: FieldRule): ReaderGate {
  return [
    (entry) => !invokes(fieldRule, entry) || entry.schemaVersion >= fieldRule.minReader,
    {
      message: `${fieldRule.refusal} schemaVersion ${fieldRule.minReader}`,
      path: ['schemaVersion']
    }
  ]
}
