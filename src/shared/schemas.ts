import { z } from 'zod'
import { DEFAULT_ANALYSIS_SYSTEM_PROMPT } from '@shared/constants'

// Shared Zod schemas for Birdbrain's trust boundaries.
//
// These schemas validate data that crosses a trust boundary: the Hono capture
// server (Chrome extension → main), the on-disk manifest audit log, the
// settings file, and OpenRouter API responses. See docs/zod-adoption-spike.md
// for the rationale and scope.

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

// Written as JSONL to each case directory. Every entry is either a capture
// write-ahead record or a deletion record. The chain is hash-linked;
// verifyManifestChain uses this schema to reject entries whose *shape* is
// malformed before attempting hash recomputation, so forged but
// schema-invalid lines don't propagate as undefined fields downstream.

const ManifestCaptureEntrySchema = z
  .object({
    type: z.literal('capture'),
    captureId: z.string(),
    caseId: z.string(),
    url: z.string(),
    timestamp: z.string(),
    contentHash: z.string(),
    sizeBytes: z.number(),
    operatorId: z.string(),
    operatorName: z.string(),
    toolVersion: z.string(),
    index: z.number().int().nonnegative(),
    prevHash: z.string(),
    schemaVersion: z.number(),
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
    schemaVersion: z.number(),
    entryHash: z.string()
  })
  .strict()

export const ManifestEntrySchema = z.discriminatedUnion('type', [
  ManifestCaptureEntrySchema,
  ManifestDeletionEntrySchema
])

export type ManifestEntry = z.infer<typeof ManifestEntrySchema>

// --- Settings file --------------------------------------------------------

export const BirdbrainSettingsSchema = z.object({
  openRouterApiKey: z.string().nullable(),
  defaultModel: z.string(),
  captureScreenshots: z.boolean(),
  dedupeWindowSeconds: z.number(),
  ignoredUrlPatterns: z.array(z.string()),
  storagePath: z.string(),
  theme: z.enum(['dark', 'light']),
  operatorName: z.string(),
  autoCaptureMode: z.enum(['auto', 'notify', 'per-case']),
  hasCompletedOnboarding: z.boolean().optional().default(false),
  analysisSystemPrompt: z.string().optional().default(DEFAULT_ANALYSIS_SYSTEM_PROMPT)
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
