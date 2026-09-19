import { z } from 'zod'
import {
  DEFAULT_ANALYSIS_SYSTEM_PROMPT,
  DEFAULT_TSA_URL,
  MANIFEST_SCHEMA_VERSION
} from '@shared/constants'
import {
  CAPTURE_METHODS,
  CONSENT_SUPPRESSIONS,
  DEFAULT_UI_DENSITY,
  UI_DENSITIES
} from '@shared/types'
import type {
  ActiveCaseSelectors,
  BirdbrainSettings,
  Note,
  Selector,
  SelectorMatch
} from '@shared/types'

// Shared Zod schemas for Birdbrain's trust boundaries.
//
// These schemas validate data that crosses a trust boundary: the Hono capture
// server (Chrome extension → main), the on-disk manifest audit log, the
// settings file, and OpenRouter API responses. See
// docs/specs/2026-04-20-zod-adoption-spike.md for the rationale and scope.

// --- Capture server: POST /api/captures -----------------------------------

// Hono's parseBody returns file uploads as File-like objects. We duck-type
// rather than using z.instanceof(File) because Node's File global is not
// guaranteed to be the same constructor Hono produces across versions.
export type FormFileLike = {
  arrayBuffer(): Promise<ArrayBuffer>
  stream(): ReadableStream<Uint8Array>
  size: number
  type?: string
  text?(): Promise<string>
}

const FormFileSchema = z.custom<FormFileLike>(
  (v) => !!v && typeof v === 'object' && 'arrayBuffer' in v && 'stream' in v
)

export const CaptureSourceSchema = z.enum(['auto', 'manual', 'selector'])

// The sources the wire accepts, which is deliberately narrower than the domain
// `CaptureSource` in @shared/types: 'recapture' is produced in-app by the
// recapture service and never uploaded over this endpoint. Callers building a
// request must use this type, not the domain one — the Zod parse below rejects
// anything else with a 400, and typing the request against the wider union
// would let that drift past `pnpm typecheck`.
export type CaptureUploadSource = z.infer<typeof CaptureSourceSchema>

// Response headers arrive as a JSON string in a multipart form field. They are
// an untrusted, extension-supplied value that ends up in the signed manifest, so
// the parse is defensive: malformed JSON, non-object shapes, or non-string
// values coerce to undefined (treated as "no headers") rather than failing the
// whole capture. The serialized size is bounded so a hostile/huge header set
// can't bloat the signed manifest body.
const MAX_HEADERS_JSON_BYTES = 64 * 1024

const HeadersFieldSchema = z.preprocess((raw) => {
  if (typeof raw !== 'string' || raw.trim() === '') return undefined
  if (Buffer.byteLength(raw, 'utf-8') > MAX_HEADERS_JSON_BYTES) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return undefined
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof v === 'string') out[k] = v
  }
  return Object.keys(out).length > 0 ? out : undefined
}, z.record(z.string(), z.string()).optional())

export const CaptureUploadSchema = z.object({
  source: CaptureSourceSchema,
  url: z
    .string()
    .min(1)
    .max(8192)
    .refine(
      (u) => {
        try {
          const parsed = new URL(u)
          return ['http:', 'https:'].includes(parsed.protocol) || u.startsWith('birdbrain://')
        } catch {
          return false
        }
      },
      { message: 'URL must use http, https, or birdbrain protocol' }
    ),
  title: z.string().optional().default(''),
  timestamp: z.string().optional().default(''),
  textContent: z.string().optional().default(''),
  extensionVersion: z.string().optional().default(''),
  browserVersion: z.string().optional().default(''),
  userAgent: z.string().optional().default(''),
  caseId: z.string().optional().default(''),
  httpStatus: z.coerce.number().catch(0),
  headers: HeadersFieldSchema,
  mhtml: FormFileSchema,
  screenshot: z.unknown().optional()
})

export type CaptureUpload = z.infer<typeof CaptureUploadSchema>

// --- Capture server: response DTOs ----------------------------------------

// The other half of the extension wire contract: what the capture server sends
// back. These are plain types, not Zod schemas — validation stays one-way (the
// server validates the extension's requests; the extension trusts the server's
// responses). Their job is to make a response change a compile error on both
// sides instead of silent runtime drift: the route handlers below assert
// against them with `satisfies`, and the extension imports the same types.
// Optional fields mean "the server may omit this", not "the field is new".

/** A case as advertised in GET /api/status — identity only. */
export interface CaptureServerCaseRef {
  id: string
  name: string
}

/** A case as returned by GET /api/cases — identity plus its capture count. */
export interface CaptureServerCase extends CaptureServerCaseRef {
  captureCount: number
}

/** GET /api/status */
export interface CaptureServerStatus {
  running: boolean
  /** Only sent to the extension (or an origin-less caller); never cross-origin. */
  serverToken?: string
  activeCase: CaptureServerCaseRef | null
  sessionActive: boolean
  captureCount: number
  autoCaptureMode: BirdbrainSettings['autoCaptureMode']
  /** Empty when the caller passed `?includeCases=0`. */
  cases: CaptureServerCaseRef[]
  /** The operator's global ignore list, unchanged by any case's policy. */
  ignoredUrlPatterns: string[]
  /**
   * What is actually in force for the active case (#400): the global list plus
   * that case's exclusions, or the case's alone under 'override'. The global
   * list when no case is active.
   *
   * Optional because a pre-#400 server does not send it and the extension
   * updates independently of the app; the extension falls back to
   * `ignoredUrlPatterns`, so an older server degrades to global-only advisory
   * filtering rather than to none. The server always sets it.
   */
  effectiveIgnoredUrlPatterns?: string[]
  captureScreenshots: boolean
  dedupeWindowSeconds: number
  theme: BirdbrainSettings['theme']
}

/** Whether a screenshot accompanied the capture, and whether it was kept. */
export type ScreenshotStatus = 'saved' | 'dropped' | 'none'

/** POST /api/captures — success body. */
export interface CaptureUploadResult {
  captureId: string
  hash: string
  /** Absent when the capture was stored without a manifest entry. */
  manifestIndex?: number
  status: 'ok'
  /** Echoed back from the request, so it is the wire union, not the domain one. */
  source: CaptureUploadSource
  screenshotStatus: ScreenshotStatus
  /** Why the screenshot was dropped; absent when none was. */
  screenshotWarning?: string
}

/** GET /api/selectors/active — grouped by case, empty when no case is active. */
export type ActiveSelectorsResult = ActiveCaseSelectors[]

/** POST /api/selectors — success body. */
export interface SelectorCreateResult {
  selector: Selector
  status: 'ok'
}

/**
 * A selector hit reported by the content script and forwarded to the server on
 * the `matchedSelectors` capture field. Same shape as the in-app SelectorMatch.
 */
export type SelectorMatchInfo = SelectorMatch

// --- Capture server: POST /api/selectors ----------------------------------

export const SelectorCreateSchema = z.object({
  caseId: z.string().min(1),
  pattern: z.string().trim().min(1),
  // Non-string labels coerce to undefined to preserve legacy behavior where
  // garbage from the extension was silently ignored rather than rejected.
  label: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined),
    z.string().optional()
  )
})

export type SelectorCreate = z.infer<typeof SelectorCreateSchema>

// --- Capture server: extension write endpoints (#392) ----------------------

// Stricter than CaptureUploadSchema's url field on purpose: birdbrain:// is a
// pipeline-test sentinel, and an annotation can only ever bind to a page.
const HttpUrlField = z
  .string()
  .min(1)
  .max(8192)
  .refine(
    (u) => {
      try {
        return ['http:', 'https:'].includes(new URL(u).protocol)
      } catch {
        return false
      }
    },
    { message: 'URL must use http or https' }
  )

// The shared shape of the two attach routes (POST /api/tags/apply and
// POST /api/notes): caseId + url identify the Capture to attach to, and the
// remaining fields are the optional auto-capture payload — the same multipart
// shape POST /api/captures takes (R2), minus `source` (an attach capture is
// always operator-witnessed) and with `mhtml` optional: absent means "attach
// only", and the route refuses rather than acquiring bytes some other way.
const ExtensionAttachBaseSchema = z.object({
  caseId: z.string().min(1),
  url: HttpUrlField,
  title: z.string().optional().default(''),
  timestamp: z.string().optional().default(''),
  textContent: z.string().optional().default(''),
  extensionVersion: z.string().optional().default(''),
  browserVersion: z.string().optional().default(''),
  userAgent: z.string().optional().default(''),
  httpStatus: z.coerce.number().catch(0),
  headers: HeadersFieldSchema,
  mhtml: FormFileSchema.optional(),
  screenshot: z.unknown().optional()
})

export type ExtensionAttachBase = z.infer<typeof ExtensionAttachBaseSchema>

export const ExtensionTagApplySchema = ExtensionAttachBaseSchema.extend({
  tagName: z.string().trim().min(1).max(200)
})

export type ExtensionTagApply = z.infer<typeof ExtensionTagApplySchema>

export const ExtensionNoteCreateSchema = ExtensionAttachBaseSchema.extend({
  noteTitle: z.string().optional().default(''),
  noteText: z.string().trim().min(1).max(100_000)
})

export type ExtensionNoteCreate = z.infer<typeof ExtensionNoteCreateSchema>

// POST /api/captures/lookup — a read carried as a POST on purpose: the token
// guard fires on POST only, so a GET here would answer any local process
// without a token and leak whether a case holds a URL (R23, #817).
export const UrlLookupSchema = z.object({
  caseId: z.string().min(1),
  url: HttpUrlField
})

export type UrlLookup = z.infer<typeof UrlLookupSchema>

/** POST /api/captures/lookup — success body. */
export interface UrlLookupResult {
  found: boolean
  /** What the url resolved to under @shared/urlCanonicalize's rules. */
  canonicalUrl: string
  capture: { id: string; url: string; title: string; timestamp: string } | null
}

/** POST /api/tags/apply — success body. */
export interface ExtensionTagApplyResult {
  status: 'ok'
  captureId: string
  /** True when the route ingested the supplied payload rather than attaching to an existing Capture. */
  captured: boolean
  /**
   * 'none' whenever nothing was saved: on an attach to an existing Capture,
   * which acquires nothing, and on an ingest that carried no screenshot.
   */
  screenshotStatus: ScreenshotStatus
  /** Why the screenshot was dropped; absent when none was. */
  screenshotWarning?: string
  tag: { id: string; name: string }
}

/** POST /api/notes — success body. */
export interface ExtensionNoteCreateResult {
  status: 'ok'
  captureId: string
  captured: boolean
  screenshotStatus: ScreenshotStatus
  screenshotWarning?: string
  note: Note
}

// --- Zod → HTTP error formatting ------------------------------------------

// Maps the first Zod issue to an error string that matches the shapes the
// Chrome extension and existing tests expect. Tests assert on substrings like
// 'Invalid source', 'caseId', 'pattern', so the mapping is keyed on field path.

export function formatCaptureUploadError(err: z.core.$ZodError): string {
  const first = err.issues[0]
  if (!first) return 'Invalid request'
  const path = first.path.join('.')
  if (path === 'source') return 'Invalid source'
  if (path === 'mhtml') return 'Missing required field: mhtml (file)'
  if (path === 'url') return 'Missing required field: url'
  if (path === 'caseId') return 'Missing required field: caseId'
  return first.message || `Invalid field: ${path}`
}

export function formatSelectorCreateError(err: z.core.$ZodError): string {
  const first = err.issues[0]
  if (!first) return 'Invalid request'
  const path = first.path.join('.')
  if (path === 'caseId') return 'Missing required field: caseId'
  if (path === 'pattern') return 'Missing or empty required field: pattern'
  return first.message || `Invalid field: ${path}`
}

// One formatter for the three #392 routes: they share the base shape, and the
// lookup's two fields are a subset of it.
export function formatExtensionAttachError(err: z.core.$ZodError): string {
  const first = err.issues[0]
  if (!first) return 'Invalid request'
  const path = first.path.join('.')
  if (path === 'caseId') return 'Missing required field: caseId'
  if (path === 'url') return 'Missing or invalid required field: url'
  if (path === 'tagName') return 'Missing or empty required field: tagName'
  if (path === 'noteText') return 'Missing or empty required field: noteText'
  if (path === 'mhtml') return 'Invalid field: mhtml (file)'
  return first.message || `Invalid field: ${path}`
}

// --- Manifest entries -----------------------------------------------------

// Written as JSONL to each case directory. Every entry is a capture
// write-ahead record, a deletion record, or a timestamp anchor. The chain is
// hash-linked; verifyManifestChain uses this schema to reject entries whose
// *shape* is malformed before attempting hash recomputation, so forged but
// schema-invalid lines don't propagate as undefined fields downstream.
//
// Schema versioning (per-entry `schemaVersion`): v1 entries carry only the
// chain fields + entryHash. v2 introduces an optional per-entry `signature`
// (computed over entryHash, EXCLUDED from the canonical body — same
// immutability rule as entryHash), optional `screenshotHash`/`textHash`, and
// the `timestamp` entry type. The schema accepts `signature` on every entry
// type so legacy v1 chains round-trip unchanged; signature *creation* and
// *cryptographic verification* are out of scope here (see #117), as is
// timestamp *creation* / RFC 3161 (see #120) and screenshot/text hashing
// (see #118). v3 adds the `exhibit`, `derivation` and `renumber` entry types
// (ADR-0023) and generalizes `deletion` and `timestamp` to any Exhibit;
// `capture` entries are unchanged. Mixed-version chains are normal — never
// retro-sign legacy entries.

// Bounded integer: rejects negatives, floats, NaN, and unknown-future versions
// (e.g. a v4 entry parsed by a v3 verifier). Auto-tightens on every version bump.
// A version ABOVE the bound is not reported as a malformed shape: verify-core
// screens for it first and reports "verifier too old" (manifestChain.ts, X25).
const schemaVersionField = z.number().int().min(1).max(MANIFEST_SCHEMA_VERSION)

// The v3 entry types (ADR-0023) have no v1/v2 form, so they are pinned at 3 —
// the same discipline as the v2-only types below, and it makes them signed by
// construction (verify-core enforces signatures from v2 up).
const schemaVersion3Field = z.number().int().min(3).max(MANIFEST_SCHEMA_VERSION)

// Corroboration-only TLS cert chain re-fetched from the origin AFTER the capture
// is stored (#123, ADR-0002). NOT bound to the captured transaction — it records
// whatever cert the origin served at `refetchedAt`, which differs from the
// capture timestamp. Anchored into the signed manifest body so chain integrity
// covers it for free. Either a chain (leaf→root, SANs pre-sorted by the producer)
// or a fail-soft error marker; OMITTED entirely when the re-fetch was not run, so
// legacy / cert-less entries keep identical entryHashes. `.strict()` so a forged
// extra field is rejected before hashing.
export const TlsCertSummarySchema = z
  .object({
    subject: z.string(),
    issuer: z.string(),
    validFrom: z.string(),
    validTo: z.string(),
    fingerprint256: z.string(),
    serialNumber: z.string(),
    subjectAltNames: z.array(z.string())
  })
  .strict()

export const TlsCertChainSchema = z
  .object({
    url: z.string(),
    refetchedAt: z.string(),
    chain: z.array(TlsCertSummarySchema)
  })
  .strict()

export const TlsCertChainErrorSchema = z
  .object({
    url: z.string(),
    refetchedAt: z.string(),
    error: z.string()
  })
  .strict()

export const TlsCertChainResultSchema = z.union([TlsCertChainSchema, TlsCertChainErrorSchema])

const ManifestCaptureEntrySchema = z
  .object({
    type: z.literal('capture'),
    captureId: z.string(),
    caseId: z.string(),
    url: z.string(),
    timestamp: z.string(),
    contentHash: z.string(),
    screenshotHash: z.string().optional(),
    textHash: z.string().optional(),
    headers: z.record(z.string(), z.string()).optional(),
    // Transaction provenance (R7, #797). `httpStatus` is the status the
    // acquiring path recorded for the stored response; `finalUrl` is the URL
    // the stored bytes were served from, written only by a path that resolved
    // one AND saw it differ from the URL that was requested — its presence is
    // the entry's statement that a redirect took the capture somewhere other
    // than where it was aimed. Both optional and OMITTED (never 0 / '' / null)
    // when unknown, so every entry written before R7 keeps its canonical body
    // and therefore its chain hash. The status range is HTTP's own (RFC 9110
    // §15); a value outside it is not a status and is never written.
    httpStatus: z.number().int().min(100).max(599).optional(),
    finalUrl: z.string().min(1).optional(),
    tls: TlsCertChainResultSchema.optional(),
    method: z.enum(CAPTURE_METHODS).optional(),
    supersedesCaptureId: z.string().optional(),
    // Duplication provenance (#827), carried by entries whose method is
    // 'duplicate': the capture whose bytes were copied, and when the copy was
    // made. Both optional and omitted from every other entry, so legacy and
    // ordinary capture bodies — and their chain hashes — are unchanged.
    duplicateOfCaptureId: z.string().optional(),
    duplicatedAt: z.string().optional(),
    consentSuppression: z.enum(CONSENT_SUPPRESSIONS).optional(),
    sizeBytes: z.number(),
    operatorId: z.string(),
    operatorName: z.string(),
    toolVersion: z.string(),
    index: z.number().int().nonnegative(),
    prevHash: z.string(),
    schemaVersion: schemaVersionField,
    signature: z.string().optional(),
    entryHash: z.string()
  })
  .strict()

// Deletion of an anchored Exhibit. `captureId` and `contentHash` accept ANY
// Exhibit id and Content Hash from schema v3 on, not only a Capture's
// (ADR-0023, X29) — a Capture is one kind of Exhibit and its Exhibit id IS its
// capture id, so the field keeps its name: renaming it would fork the shape and
// break the canonical bodies (and therefore the chain hashes) of every deletion
// entry already written.
const ManifestDeletionEntrySchema = z
  .object({
    type: z.literal('deletion'),
    captureId: z.string(),
    caseId: z.string(),
    timestamp: z.string(),
    contentHash: z.string(),
    operatorId: z.string(),
    operatorName: z.string(),
    toolVersion: z.string(),
    reason: z.string().optional(),
    index: z.number().int().nonnegative(),
    prevHash: z.string(),
    schemaVersion: schemaVersionField,
    signature: z.string().optional(),
    entryHash: z.string()
  })
  .strict()

// Append-only timestamp anchor introduced in schema v2. References an anchored
// entry's contentHash; the trusted-time token (RFC 3161) is attached later by
// #120 — this schema only lets the entry round-trip and keep the chain valid.
// From v3 the referenced hash is ANY Exhibit's Content Hash, not only a
// Capture's (ADR-0023, X26): committing an Exhibit runs the same RFC 3161 path
// as ingesting a Capture, so Trusted Time is uniform across kinds. The field
// keeps its `captureContentHash` name for the same hash-stability reason as the
// deletion entry above.
const ManifestTimestampEntrySchema = z
  .object({
    type: z.literal('timestamp'),
    caseId: z.string(),
    captureContentHash: z.string(),
    timestamp: z.string(),
    tsaToken: z.string().optional(),
    operatorId: z.string(),
    operatorName: z.string(),
    toolVersion: z.string(),
    index: z.number().int().nonnegative(),
    prevHash: z.string(),
    schemaVersion: z.number().int().min(2).max(MANIFEST_SCHEMA_VERSION),
    signature: z.string().optional(),
    entryHash: z.string()
  })
  .strict()

// Signed audit record of an evidence-package export (#124). schemaVersion is
// pinned >=2 so the entry MUST carry a signature, matching the timestamp entry.
// `packageHash` is computed over evidence.json's artifact list by the recipe
// owned by packageHash() in src/shared/verify/packageHash.ts.
// `verificationResult` is a fixed integer+boolean shape so it serializes
// canonically and stays stable under hashing+signing.
const ManifestExportVerificationResultSchema = z
  .object({
    overallValid: z.boolean(),
    captureCount: z.number().int().nonnegative(),
    verifiedCount: z.number().int().nonnegative(),
    tamperedCount: z.number().int().nonnegative(),
    missingCount: z.number().int().nonnegative()
  })
  .strict()

const ManifestExportEntrySchema = z
  .object({
    type: z.literal('export'),
    caseId: z.string(),
    timestamp: z.string(),
    operatorId: z.string(),
    operatorName: z.string(),
    toolVersion: z.string(),
    packageHash: z.string(),
    verificationResult: ManifestExportVerificationResultSchema,
    // Selection scope (#398, ADR-0009). Present-means-selection: a case-scoped
    // export OMITS both keys (never null/''/[]), so legacy and case-scoped
    // entries keep identical canonical bodies and chain hashes. Both MUST stay
    // `.optional()` with NO `.default()`: a required key makes every legacy
    // export entry fail this .strict() schema ('Invalid entry shape'), and a
    // default is injected into the parsed output manifestChain re-hashes,
    // breaking every legacy export entry ('Entry hash mismatch').
    scope: z.literal('selection').optional(),
    captureIds: z.array(z.string()).optional(),
    // Export class (#399, ADR-0010). Present-means-working-copy: an evidence
    // export OMITS the key — never null, never 'evidence' — under the same
    // omit-when-absent discipline as `scope` above, and for the same reasons
    // it must stay `.optional()` with NO `.default()`.
    exportClass: z.literal('working-copy').optional(),
    index: z.number().int().nonnegative(),
    prevHash: z.string(),
    schemaVersion: z.number().int().min(2).max(MANIFEST_SCHEMA_VERSION),
    signature: z.string().optional(),
    entryHash: z.string()
  })
  .strict()

export const ArchiveVerificationResultSchema = z
  .object({
    overallValid: z.boolean(),
    chainValid: z.boolean(),
    chainReason: z.string().optional(),
    artifactCount: z.number().int().nonnegative(),
    artifactFailureCount: z.number().int().nonnegative(),
    captureCount: z.number().int().nonnegative(),
    captureHashFailureCount: z.number().int().nonnegative()
  })
  .strict()

// Signed audit record of a case-archive export (.birdbrain). `packageHash` is
// computed over package.json's artifact list by the recipe owned by
// packageHash() in src/shared/verify/packageHash.ts.
const ManifestArchiveExportEntrySchema = z
  .object({
    type: z.literal('archive-export'),
    caseId: z.string(),
    timestamp: z.string(),
    operatorId: z.string(),
    operatorName: z.string(),
    toolVersion: z.string(),
    packageHash: z.string(),
    index: z.number().int().nonnegative(),
    prevHash: z.string(),
    schemaVersion: z.number().int().min(2).max(MANIFEST_SCHEMA_VERSION),
    signature: z.string().optional(),
    entryHash: z.string()
  })
  .strict()

// Signed genesis-of-custody record appended when a case archive is imported.
// Continues the source chain (prevHash = source head). sourcePublicKeyPem is
// the key that signed every entry BEFORE this one (back to the previous import
// boundary) — verify-core switches keys at these entries.
const ManifestImportEntrySchema = z
  .object({
    type: z.literal('import'),
    caseId: z.string(),
    sourceCaseId: z.string(),
    sourceInstallationId: z.string(),
    sourcePublicKeyPem: z.string(),
    packageHash: z.string(),
    idMapSha256: z.string(),
    verificationResult: ArchiveVerificationResultSchema,
    timestamp: z.string(),
    operatorId: z.string(),
    operatorName: z.string(),
    toolVersion: z.string(),
    index: z.number().int().nonnegative(),
    prevHash: z.string(),
    schemaVersion: z.number().int().min(2).max(MANIFEST_SCHEMA_VERSION),
    signature: z.string().optional(),
    entryHash: z.string()
  })
  .strict()

// --- Schema v3: Exhibits (ADR-0023) ---------------------------------------
//
// An Exhibit is the unit of evidence and a Capture is one kind of Exhibit, so
// `capture` entries are untouched (X24) — `textHash` and `screenshotHash`
// included — and this entry anchors every Exhibit that is NOT a Capture.
//
// `kind` and `origin` are open strings, deliberately NOT enums. A verifier's
// vocabulary must not decide whether a chain verifies: an entry naming a kind
// this build has never heard of is an entry from a newer writer, and rejecting
// its shape would report a valid chain as broken — the false accusation X25
// exists to prevent. The hash and signature cover the string either way, so
// integrity is unaffected. The writer's vocabulary is fixed at commit-time by
// the app (X43), not here.
const ManifestExhibitEntrySchema = z
  .object({
    type: z.literal('exhibit'),
    exhibitId: z.string(),
    caseId: z.string(),
    kind: z.string().min(1),
    origin: z.string().min(1),
    name: z.string(),
    // Sequential per-Case integer assigned at commit and never reused (X18).
    // Recorded here so a citation ("Exhibit 7") is verifiable from the chain.
    exhibitNumber: z.number().int().positive(),
    // Storage-root-relative path of the stored bytes (`{caseId}/...`), the
    // same form `derivation.outputPath` and the `exhibits` row record.
    path: z.string(),
    contentHash: z.string(),
    sizeBytes: z.number(),
    timestamp: z.string(),
    operatorId: z.string(),
    operatorName: z.string(),
    toolVersion: z.string(),
    index: z.number().int().nonnegative(),
    prevHash: z.string(),
    schemaVersion: schemaVersion3Field,
    signature: z.string().optional(),
    entryHash: z.string()
  })
  .strict()

// One Derived File computed from an Exhibit (X17): extracted text, a thumbnail,
// a PDF metadata sidecar, an enrichment transform's output (`transform:<name>`,
// X42). A Manifest Entry cannot be amended once written, so a derivation that
// runs after its parent's ingest has nowhere in the parent's entry to be
// anchored and gets its own entry — which is also what makes one shape cover
// derivations computed at ingest and years later alike.
const ManifestDerivationEntrySchema = z
  .object({
    type: z.literal('derivation'),
    caseId: z.string(),
    // The Exhibit this was computed from, bound by BOTH its id and the Content
    // Hash the derivation ran over: the id alone would not say which bytes.
    parentExhibitId: z.string(),
    parentContentHash: z.string(),
    // Open string for the same reason `kind` is (see above).
    derivation: z.string().min(1),
    // Version of the tool that produced the output — the app's own version when
    // the derivation is computed in-app, an external tool's when it is not
    // (X23). Distinct from the entry-wide `toolVersion`, which always records
    // the Birdbrain build that wrote the entry.
    derivationToolVersion: z.string(),
    outputHash: z.string(),
    outputPath: z.string(),
    timestamp: z.string(),
    operatorId: z.string(),
    operatorName: z.string(),
    toolVersion: z.string(),
    index: z.number().int().nonnegative(),
    prevHash: z.string(),
    schemaVersion: schemaVersion3Field,
    signature: z.string().optional(),
    entryHash: z.string()
  })
  .strict()

// One assignment in the one-time renumber (X18). `manifestIndex` present means
// the Capture is anchored by the entry at that index; OMITTED means it has no
// Manifest Entry at all — a pre-v11 `html` Capture, numbered after every
// anchored Capture in capture order (X41). Present-means-anchored keeps the
// unanchored case explicit in the chain: the number is a citation aid there and
// never an anchoring claim.
const ManifestRenumberAssignmentSchema = z
  .object({
    exhibitId: z.string(),
    exhibitNumber: z.number().int().positive(),
    manifestIndex: z.number().int().nonnegative().optional()
  })
  .strict()

// The one-time assignment of Exhibit Numbers to Captures that predate them
// (X18). Written once per Case by the migration, so the assignment is itself in
// the chain and a citation cannot be re-derived differently later.
const ManifestRenumberEntrySchema = z
  .object({
    type: z.literal('renumber'),
    caseId: z.string(),
    assignments: z.array(ManifestRenumberAssignmentSchema),
    timestamp: z.string(),
    operatorId: z.string(),
    operatorName: z.string(),
    toolVersion: z.string(),
    index: z.number().int().nonnegative(),
    prevHash: z.string(),
    schemaVersion: schemaVersion3Field,
    signature: z.string().optional(),
    entryHash: z.string()
  })
  .strict()

export const ManifestEntrySchema = z.discriminatedUnion('type', [
  ManifestCaptureEntrySchema,
  ManifestDeletionEntrySchema,
  ManifestTimestampEntrySchema,
  ManifestExportEntrySchema,
  ManifestArchiveExportEntrySchema,
  ManifestImportEntrySchema,
  ManifestExhibitEntrySchema,
  ManifestDerivationEntrySchema,
  ManifestRenumberEntrySchema
])

export type ManifestEntry = z.infer<typeof ManifestEntrySchema>

// Every entry type THIS build knows, derived from the union above so the two
// can never drift. Verify-core screens an entry's `type` against this set
// before parsing it, so a type from a newer writer is reported as "verifier too
// old" instead of failing the strict parse as a malformed shape (X25).
export const MANIFEST_ENTRY_TYPES: ReadonlySet<string> = new Set(
  ManifestEntrySchema.options.map((option) => option.shape.type.value)
)

// --- Evidence package index (evidence.json) -------------------------------

// The `schemaVersion` buildEvidenceZip stamps into evidence.json. v2 added the
// `exhibits` list (#1494), and it also names the package's ERA: v1 covers both
// the pre-#398 packages that ship no export-entry.json and the post-#398 ones
// that do, so a verifier reading a v1 index cannot tell a package that
// predates export entries from one whose entry was stripped (#853). Every
// writer from v2 on seals the package with a signed export entry, so a v2 or
// later index with no entry beside it is a missing file. A later bump must
// keep that true — the verifier compares with >=.
//
// Defined here rather than in constants.ts so it sits beside the schema whose
// version it names. Not an import boundary: build-verifier.mjs aliases all of
// @shared/* into the bundle (its one rule is no electron and no src/main), and
// @shared/verify/manifestChain.ts already reaches @shared/constants directly.
export const EVIDENCE_INDEX_SCHEMA_VERSION = 2

// `evidence.json` is the UNSIGNED convenience index emitted by buildEvidenceZip.
// Only `manifest.jsonl` is signed, so the standalone verifier (#122) treats this
// index as untrusted: it parses it for structure, then reconciles every field
// against the verified chain (§7.4/§7.5 of the verifier design). This schema is
// deliberately permissive about fields the verifier does not consume (it does
// not `.strict()`) so adding informational keys to the export never breaks
// verification; it pins only what §7 reads — the manifest head, the per-capture
// ids/paths/hashes, and the artifact digests.
const EvidenceArtifactSchema = z.object({
  path: z.string(),
  sha256: z.string(),
  sizeBytes: z.number().int().nonnegative()
})

const EvidenceCaptureSchema = z.object({
  id: z.string(),
  mhtmlPath: z.string().nullable().optional(),
  mhtmlSha256: z.string().nullable().optional(),
  screenshotPath: z.string().nullable().optional(),
  screenshotSha256: z.string().nullable().optional(),
  textSha256: z.string().nullable().optional(),
  timestampTokenPaths: z.array(z.string())
})

// One Derived File as the index lists it, nested under the Exhibit it was
// computed from (#1156). It carries no Exhibit Number: a Derived File is cited
// by its parent and its derivation, never numbered of its own (X31).
const EvidenceDerivedFileSchema = z.object({
  derivation: z.string(),
  contentHash: z.string(),
  path: z.string().nullable()
})

// One Exhibit of any kind (ADR-0023). `exhibits` is additive: `captures` keeps
// its shape and its rows, so a verifier built before this list existed reads
// the same package it always did. The kind vocabulary is an open string here
// for the same reason it is on the manifest entry — an index naming a kind this
// build has not heard of is an index from a newer writer, not a malformed one.
const EvidenceExhibitSchema = z.object({
  id: z.string(),
  kind: z.string(),
  origin: z.string(),
  exhibitNumber: z.number().int().positive(),
  name: z.string(),
  contentHash: z.string(),
  // Package-relative path of the enclosed bytes, null when the package does not
  // enclose them (the file was unreadable at export time, and the warnings
  // block counts it).
  path: z.string().nullable(),
  // Where the package encloses this Exhibit's RFC 3161 token, when one is
  // enclosed. A locating hint only, like the capture row's: the verifier
  // byte-binds whatever it finds to the token the signed entry carries, so the
  // path carries no security weight. Optional for an index written before the
  // field existed.
  timestampTokenPaths: z.array(z.string()).optional(),
  derivedFiles: z.array(EvidenceDerivedFileSchema)
})

export const EvidencePackageSchema = z.object({
  // 1: `captures` only. 2: the additive `exhibits` list below, which the
  // verifier reconciles against the chain exactly as it reconciles `captures`.
  schemaVersion: z.number().int().positive(),
  verificationMaterials: z.object({
    manifestPath: z.string(),
    // Head index/hash are null for an empty manifest; the verifier cross-checks
    // them against the verified chain's last entry (§7.4).
    manifestHeadIndex: z.number().int().nonnegative().nullable(),
    manifestHeadHash: z.string().nullable(),
    signingPublicKeyPath: z.string(),
    // Packages before #579 shipped one mixed `tsa-ca-chain.pem`; later ones ship
    // a self-signed anchor (null when no anchor is bundled for the configured
    // TSA) and the deduped chain-building material separately.
    tsaCaChainPath: z.string().optional(),
    tsaRootPath: z.string().nullable().optional(),
    tsaRootSha256: z.string().nullable().optional(),
    tsaIntermediatesPath: z.string().optional()
  }),
  captures: z.array(EvidenceCaptureSchema),
  // Optional so a schemaVersion 1 package — every package written before
  // #1156 — still parses. The verifier requires it from schemaVersion 2 on,
  // where its absence is an edited index rather than an older writer.
  exhibits: z.array(EvidenceExhibitSchema).optional(),
  artifacts: z.array(EvidenceArtifactSchema)
})

export type EvidencePackage = z.infer<typeof EvidencePackageSchema>

// --- Working Copy marker (WORKING-COPY.json) ------------------------------

// A Working Copy export (#399, ADR-0010) self-identifies through this marker at
// the package root. It is UNSIGNED and confers nothing: the verifier reads it
// only when `manifest.jsonl` is absent, to report "not a verifiable object"
// instead of FAIL — a present manifest is always verified, so a planted marker
// can never silence a chain. Defined here (not in constants.ts) so it sits
// beside the marker schema it names.
export const WORKING_COPY_MARKER_FILENAME = 'WORKING-COPY.json'

// Deliberately non-strict, pinning only what the verifier branches on: future
// informational keys must not turn an honest marker unreadable for
// already-distributed verifier binaries.
export const WorkingCopyMarkerSchema = z.object({
  exportClass: z.literal('working-copy')
})

// --- Settings file --------------------------------------------------------

// `tsaUrl` is a trust-boundary value handed straight to fetch(). Normalize it on
// load so a hand-edited or legacy settings file can't push a whitespace or
// non-http(s) endpoint into the timestamp worker. Crucially this NEVER throws —
// invalid input is coerced to the DigiCert default — so an only-tsaUrl-invalid
// file doesn't fail safeParse and reset every other setting to defaults.
function normalizeTsaUrl(value: unknown): string {
  if (typeof value !== 'string') return DEFAULT_TSA_URL
  const trimmed = value.trim()
  if (!trimmed) return DEFAULT_TSA_URL
  try {
    const { protocol } = new URL(trimmed)
    return protocol === 'http:' || protocol === 'https:' ? trimmed : DEFAULT_TSA_URL
  } catch {
    return DEFAULT_TSA_URL
  }
}

export const BirdbrainSettingsSchema = z.object({
  openRouterApiKey: z.string().nullable(),
  defaultModel: z.string(),
  captureScreenshots: z.boolean(),
  dedupeWindowSeconds: z.number(),
  ignoredUrlPatterns: z.array(z.string()),
  storagePath: z.string(),
  theme: z.enum(['dark', 'light']),
  reduceMotion: z.boolean(),
  density: z.enum(UI_DENSITIES).optional().default(DEFAULT_UI_DENSITY),
  operatorName: z.string(),
  operatorRole: z.string().default(''),
  operatorOrganization: z.string().default(''),
  tsaUrl: z.preprocess(normalizeTsaUrl, z.string()).optional().default(DEFAULT_TSA_URL),
  autoCaptureMode: z.enum(['auto', 'notify', 'per-case']),
  lastActiveCaseId: z.string().nullable(),
  // 'selectors' and 'tags' are gone as routes (#400/#700) but are still in
  // settings files written before this release, so they stay in the enum:
  // dropping them would fail the whole settings parse on upgrade. They are
  // mapped to 'signals' on read — see useSessionRestore.
  lastActiveSection: z
    .enum(['overview', 'captures', 'selectors', 'notes', 'tags', 'signals', 'settings', 'data'])
    .optional()
    .default('captures'),
  hasCompletedOnboarding: z.boolean().optional().default(false),
  analysisSystemPrompt: z.string().optional().default(DEFAULT_ANALYSIS_SYSTEM_PROMPT),
  detailsPanelCollapsed: z.boolean().optional().default(false),
  tooltipsSeen: z.record(z.string(), z.boolean()).optional().default({}),
  // Coach-mark tour state (#404). `onboardingChapters` records which chapters
  // have run so none auto-fires twice; `isFreshInstall` is latched once at
  // first launch (see initSettings) and is what confines auto-firing to new
  // installs. Both are optional-with-default, so a settings file written
  // before this release loads unchanged.
  onboardingChapters: z.record(z.string(), z.boolean()).optional().default({}),
  isFreshInstall: z.boolean().optional().default(false),
  // Latched once the bundled demonstration Case Archive has been offered to
  // this install (#405), whether the import succeeded or not, so a build with a
  // broken fixture does not retry the same missing file on every launch. Read
  // by `seedDemoCaseIfNeeded` and nowhere else, and that has one caller —
  // startup. Replaying the tour imports nothing. Not the only thing standing
  // between an install and a second copy either: this write can fail, and the
  // `is_demo` probe in the database is what holds when it does (#1301).
  demoCaseSeeded: z.boolean().optional().default(false),
  releaseChannel: z.enum(['stable', 'beta']).optional().default('stable'),
  autoCheckForUpdates: z.boolean().optional().default(true)
})

// Used on load: user may have an older settings file missing newer keys, so
// every field is optional and the result is merged over defaults in the loader.
export const PartialBirdbrainSettingsSchema = BirdbrainSettingsSchema.partial()

// --- OpenRouter API response ----------------------------------------------

export const OpenRouterResponseSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({
          content: z.string()
        })
      })
    )
    .min(1),
  usage: z
    .object({
      prompt_tokens: z.number(),
      completion_tokens: z.number(),
      total_tokens: z.number()
    })
    .optional()
})

export type OpenRouterResponseParsed = z.infer<typeof OpenRouterResponseSchema>
