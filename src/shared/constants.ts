export const CAPTURE_SERVER_PORT = 19845
export const CAPTURE_SERVER_BASE_URL = `http://127.0.0.1:${CAPTURE_SERVER_PORT}`

// Hard cap on MHTML upload size (bytes). 200 MB matches UI guidance in settings.
export const MAX_MHTML_SIZE = 200 * 1024 * 1024

// Hard cap on screenshot upload size (bytes). Matches extension CAPTURE_MAX_BYTES.
export const MAX_SCREENSHOT_SIZE = 100 * 1024 * 1024

// Audit manifest filename, written alongside captures in each case directory.
export const MANIFEST_FILENAME = 'manifest.jsonl'

// Bump whenever the manifest entry schema changes (e.g. new required fields).
export const MANIFEST_SCHEMA_VERSION = 1

export const DEFAULT_ANALYSIS_SYSTEM_PROMPT =
  'You are an expert investigative analyst reviewing web captures collected as part of a digital investigation. Analyze the provided capture in the context of the case description and metadata. Provide a clear, structured assessment covering key findings, notable entities, potential risks, and recommended next steps. Be concise but thorough.'

// Hard cap on capture text fed to the analysis model (bytes). Prevents loading
// the full file when only a truncated prefix will be sent.
export const MAX_ANALYSIS_TEXT_BYTES = 200_000
