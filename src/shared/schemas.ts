import { z } from 'zod'
import {
  DEFAULT_ANALYSIS_SYSTEM_PROMPT,
  DEFAULT_TSA_URL,
  MANIFEST_SCHEMA_VERSION
} from '@shared/constants'

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

// --- Zod → HTTP error formatting ------------------------------------------

// Maps the first Zod issue to an error string that matches the shapes the
// Chrome extension and existing tests expect. Tests assert on substrings like
// 'Invalid source', 'caseId', 'pattern', so the mapping is keyed on field path.

export function formatCaptureUploadError(err: z.ZodError): string {
  const first = err.issues[0]
  if (!first) return 'Invalid request'
  const path = first.path.join('.')
  if (path === 'source') return 'Invalid source'
  if (path === 'mhtml') return 'Missing required field: mhtml (file)'
  if (path === 'url') return 'Missing required field: url'
  if (path === 'caseId') return 'Missing required field: caseId'
  return first.message || `Invalid field: ${path}`
}

export function formatSelectorCreateError(err: z.ZodError): string {
  const first = err.issues[0]
  if (!first) return 'Invalid request'
  const path = first.path.join('.')
  if (path === 'caseId') return 'Missing required field: caseId'
  if (path === 'pattern') return 'Missing or empty required field: pattern'
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
// (see #118). Mixed-version chains are normal — never retro-sign legacy
// entries.

// Bounded integer: rejects negatives, floats, NaN, and unknown-future versions
// (e.g. a v3 entry parsed by a v2 verifier). Auto-tightens on every version bump.
const schemaVersionField = z.number().int().min(1).max(MANIFEST_SCHEMA_VERSION)

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
    tls: TlsCertChainResultSchema.optional(),
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

// Append-only timestamp anchor introduced in schema v2. References a capture
// entry's contentHash; the trusted-time token (RFC 3161) is attached later by
// #120 — this schema only lets the entry round-trip and keep the chain valid.
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
// `packageHash` commits to the export's content WITHOUT covering the final .zip
// — that would be circular, since manifest.jsonl (which holds this entry) is
// bundled inside the zip. It is sha256(canonicalStringify(sortedArtifacts)),
// where sortedArtifacts is evidence.json's artifact list ordered by path; that
// hashes every packaged file's content without depending on this entry.
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

// Signed audit record of a case-archive export (.birdbrain). packageHash uses
// the same recipe as the evidence export: sha256(canonicalStringify(sorted
// artifacts)), never hashing the final zip (circular — this entry's manifest
// copy ships inside it).
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

export const ManifestEntrySchema = z.discriminatedUnion('type', [
  ManifestCaptureEntrySchema,
  ManifestDeletionEntrySchema,
  ManifestTimestampEntrySchema,
  ManifestExportEntrySchema,
  ManifestArchiveExportEntrySchema,
  ManifestImportEntrySchema
])

export type ManifestEntry = z.infer<typeof ManifestEntrySchema>

// --- Evidence package index (evidence.json) -------------------------------

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

export const EvidencePackageSchema = z.object({
  schemaVersion: z.number().int().positive(),
  verificationMaterials: z.object({
    manifestPath: z.string(),
    // Head index/hash are null for an empty manifest; the verifier cross-checks
    // them against the verified chain's last entry (§7.4).
    manifestHeadIndex: z.number().int().nonnegative().nullable(),
    manifestHeadHash: z.string().nullable(),
    signingPublicKeyPath: z.string(),
    tsaCaChainPath: z.string()
  }),
  captures: z.array(EvidenceCaptureSchema),
  artifacts: z.array(EvidenceArtifactSchema)
})

export type EvidencePackage = z.infer<typeof EvidencePackageSchema>

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
  operatorName: z.string(),
  operatorRole: z.string().default(''),
  operatorOrganization: z.string().default(''),
  tsaUrl: z.preprocess(normalizeTsaUrl, z.string()).optional().default(DEFAULT_TSA_URL),
  autoCaptureMode: z.enum(['auto', 'notify', 'per-case']),
  lastActiveCaseId: z.string().nullable(),
  lastActiveSection: z
    .enum(['overview', 'captures', 'selectors', 'notes', 'tags', 'settings', 'data'])
    .optional()
    .default('captures'),
  hasCompletedOnboarding: z.boolean().optional().default(false),
  analysisSystemPrompt: z.string().optional().default(DEFAULT_ANALYSIS_SYSTEM_PROMPT),
  detailsPanelCollapsed: z.boolean().optional().default(false),
  tooltipsSeen: z.record(z.string(), z.boolean()).optional().default({})
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
