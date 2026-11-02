import {
  ENGINE_BOUND_TLS,
  ENGINE_HASHES,
  ENGINE_INVENTORY,
  ENGINE_SCROLL_TO_LOAD
} from './captureEnginePackage'

// The schema-7 values a launched browser's `capture` entry would record
// (docs/specs/2026-10-10-capture-engine-launched-browser-design.md, "Manifest,
// schema, and verifier"; the maintainer's rulings of 2026-10-31), and the
// Persona fields (#1498, ADR-0030). Shared by the schema-7 known-answer tests,
// the schema-6 too-old test and the built-binary test so all three are handed
// the same values. Written by hand: nothing in the app writes these yet.

// What `Browser.getVersion` reports as `product` is `Chrome/150.0.7871.181`
// (the spec's probe); the entry carries it split at the slash, beside the
// family the engine launched. CI launches Chrome for Testing (decision D23).
export const LAUNCHED_BROWSER_FIELDS = {
  browserProduct: 'Chrome',
  browserVersion: '150.0.7871.181',
  browserFamily: 'chrome-for-testing'
}

export const PERSONA_FIELDS = {
  personaId: '0196f7a2-aaaa-bbbb-cccc-000000000020',
  personaLabel: 'Research account'
}

// The first slice's present Transaction Record part with the three schema-7
// members, each count distinct from the schema-6 counts so a swap shows.
export const LAUNCHED_TRANSACTION_RECORD = {
  ...ENGINE_INVENTORY.transactionRecord,
  servedByServiceWorker: 15,
  requestBodiesWithheld: 16,
  httpCacheDisabled: true
}

export const LAUNCHED_INVENTORY = {
  ...ENGINE_INVENTORY,
  transactionRecord: LAUNCHED_TRANSACTION_RECORD
}

// A passive Capture takes no PDF (the spec's "Passive capture").
export const PASSIVE_INVENTORY = {
  ...LAUNCHED_INVENTORY,
  pdf: { present: false, reason: 'not-taken-passive' }
}

// Every schema-7 field a clicked `launched` Capture with every file carries,
// over the first slice's fields, for the package fixtures.
export function launchedFields(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    method: 'launched',
    inventory: LAUNCHED_INVENTORY,
    scrollToLoad: ENGINE_SCROLL_TO_LOAD,
    transactionRecordHash: ENGINE_HASHES.transactionRecord,
    boundTls: ENGINE_BOUND_TLS,
    pdfHash: ENGINE_HASHES.pdf,
    ...LAUNCHED_BROWSER_FIELDS,
    ...PERSONA_FIELDS,
    ...overrides
  }
}

// The same for a `launched-passive` Capture taken by `passiveRule`: no
// Scroll-to-load and no PDF.
export function passiveFields(passiveRule: string): Record<string, unknown> {
  return {
    method: 'launched-passive',
    passiveRule,
    inventory: PASSIVE_INVENTORY,
    transactionRecordHash: ENGINE_HASHES.transactionRecord,
    boundTls: ENGINE_BOUND_TLS,
    ...LAUNCHED_BROWSER_FIELDS,
    ...PERSONA_FIELDS
  }
}

// The schema-2 capture body manifestSchema3.test.ts freezes, field for field.
export const SCHEMA_2_CAPTURE_BODY = {
  type: 'capture',
  captureId: '0196f7a2-aaaa-bbbb-cccc-000000000001',
  caseId: '0196f7a2-aaaa-bbbb-cccc-000000000002',
  url: 'https://example.com/page',
  timestamp: '2026-06-01T12:00:00.000Z',
  contentHash: 'a'.repeat(64),
  screenshotHash: 'b'.repeat(64),
  textHash: 'c'.repeat(64),
  sizeBytes: 123456,
  operatorId: 'op-1',
  operatorName: 'Casey Operator',
  toolVersion: '0.4.0',
  index: 0,
  prevHash: '',
  schemaVersion: 2
}

// The schema-6 body manifestSchema6.test.ts freezes as `captureEngine`.
export const SCHEMA_6_ENGINE_BODY = {
  ...SCHEMA_2_CAPTURE_BODY,
  inventory: ENGINE_INVENTORY,
  scrollToLoad: ENGINE_SCROLL_TO_LOAD,
  transactionRecordHash: 'd'.repeat(64),
  boundTls: ENGINE_BOUND_TLS,
  pdfHash: 'e'.repeat(64),
  schemaVersion: 6
}

// That body as a clicked `launched` Capture carrying every schema-7 field a
// clicked Capture can, stamped 7. Its digest is frozen in
// manifestSchema7.test.ts.
export const LAUNCHED_CAPTURE_BODY = {
  ...SCHEMA_6_ENGINE_BODY,
  method: 'launched',
  inventory: LAUNCHED_INVENTORY,
  ...LAUNCHED_BROWSER_FIELDS,
  ...PERSONA_FIELDS,
  schemaVersion: 7
}

// The same as a `launched-passive` Capture a Selector match took, with the
// PDF recorded absent for that reason and no Scroll-to-load record.
export const PASSIVE_CAPTURE_BODY = {
  ...SCHEMA_2_CAPTURE_BODY,
  method: 'launched-passive',
  passiveRule: 'selector-match',
  inventory: PASSIVE_INVENTORY,
  transactionRecordHash: 'd'.repeat(64),
  boundTls: ENGINE_BOUND_TLS,
  ...LAUNCHED_BROWSER_FIELDS,
  ...PERSONA_FIELDS,
  schemaVersion: 7
}

// The schema-3 exhibit body manifestSchema3.test.ts freezes, field for field.
export const SCHEMA_3_EXHIBIT_BODY = {
  type: 'exhibit',
  exhibitId: '0196f7a2-aaaa-bbbb-cccc-000000000010',
  caseId: '0196f7a2-aaaa-bbbb-cccc-000000000002',
  kind: 'document',
  origin: 'manual-upload',
  name: 'witness-statement.pdf',
  exhibitNumber: 7,
  path: 'documents/0196f7a2-aaaa-bbbb-cccc-000000000010.pdf',
  contentHash: 'd'.repeat(64),
  sizeBytes: 2048,
  timestamp: '2026-06-01T12:05:00.000Z',
  operatorId: 'op-1',
  operatorName: 'Casey Operator',
  toolVersion: '0.4.0',
  index: 0,
  prevHash: '',
  schemaVersion: 3
}

// That body with the Persona fields, stamped 7. Its origin stays one ADR-0030
// does not list, because the verifier leaves the origin unchecked.
export const PERSONA_EXHIBIT_BODY = {
  ...SCHEMA_3_EXHIBIT_BODY,
  ...PERSONA_FIELDS,
  schemaVersion: 7
}
