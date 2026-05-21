export const CAPTURE_SERVER_PORT = 19845
export const CAPTURE_SERVER_BASE_URL = `http://127.0.0.1:${CAPTURE_SERVER_PORT}`

// Hard cap on MHTML upload size (bytes). 200 MB matches UI guidance in settings.
export const MAX_MHTML_SIZE = 200 * 1024 * 1024

// Hard cap on screenshot upload size (bytes). Matches extension CAPTURE_MAX_BYTES.
export const MAX_SCREENSHOT_SIZE = 100 * 1024 * 1024

// Audit manifest filename, written alongside captures in each case directory.
export const MANIFEST_FILENAME = 'manifest.jsonl'

// Bump whenever the manifest entry schema changes (e.g. new required fields).
// v1: Initial schema (capture, deletion entries with chain linkage)
// v2: Added signature, timestamp entry type, screenshotHash, textHash fields
export const MANIFEST_SCHEMA_VERSION = 2

// Default system prompt sent with every capture analysis request. Users can
// override this from Settings → AI; this constant is the fallback on first run
// and when the stored value is blank.
export const DEFAULT_ANALYSIS_SYSTEM_PROMPT =
  'You are an expert investigative analyst reviewing web captures collected as part of a digital investigation. Analyze the provided capture in the context of the case description and metadata. Provide a clear, structured assessment covering key findings, notable entities, potential risks, and recommended next steps. Be concise but thorough.'
