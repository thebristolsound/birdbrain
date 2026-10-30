// The link provenance fields a Capture link job would record on its `capture`
// entry (ADR-0040), shared by the schema-6 known-answer tests, the schema-5
// too-old test and the built-binary test so all three are handed the same
// values. Written by hand: nothing in the app writes these fields yet.
//
// `linkHref` is the http address the stored page linked to, and the entry's
// `url` (https) is where the redirect landed, the case where `url` alone loses
// the linked address.
export const LINK_SOURCE_CAPTURE_ID = '0196f7a2-aaaa-bbbb-cccc-000000000004'

export const LINK_FIELDS = {
  linkedFromCaptureId: LINK_SOURCE_CAPTURE_ID,
  linkedFromContentHash: '5'.repeat(64),
  linkHref: 'http://example.com/page'
}

// The schema-2 capture body manifestSchema3.test.ts freezes, field for field,
// with the three fields added and stamped 6. Its digest is frozen in
// manifestSchema6LinkProvenance.test.ts.
export const LINK_CAPTURE_BODY = {
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
  ...LINK_FIELDS,
  schemaVersion: 6
}
