export const CAPTURE_SERVER_PORT = 19845
export const CAPTURE_SERVER_BASE_URL = `http://127.0.0.1:${CAPTURE_SERVER_PORT}`

// Hard cap on MHTML upload size (bytes). 200 MB matches UI guidance in settings.
export const MAX_MHTML_SIZE = 200 * 1024 * 1024

// Hard cap on screenshot upload size (bytes): the capture server drops a
// screenshot whose *encoded PNG* exceeds this.
export const MAX_SCREENSHOT_SIZE = 100 * 1024 * 1024

// Budget the extension spends on a full-page screenshot before it stops adding
// slices (bytes). Measured on the *raw RGBA bitmap*, which is a different
// quantity from MAX_SCREENSHOT_SIZE above — a bitmap this large is ~25
// megapixels and PNG-encodes to single-digit MB, so fitting this budget says
// nothing about fitting the upload cap, and lowering the upload cap must not
// silently shrink the captured area. Same value today, deliberately not the
// same constant.
export const MAX_SCREENSHOT_BITMAP_BYTES = 100 * 1024 * 1024

// How long the capture server refuses a repeat manual capture of the same
// case+URL. Short by design — it exists to swallow double-clicks, not to
// deduplicate a session (that is dedupeWindowSeconds below).
export const MANUAL_DEDUPE_WINDOW_MS = 5_000

// Default session dedupe window (seconds) — how long the same URL is skipped
// on the auto-capture paths. Settings seeds from it and the capture server
// sends the configured value on /api/status; nothing applies it today, because
// the extension's only consumer is inside the HOTFIX-disabled auto-capture
// block (extension/src/background.ts).
export const DEFAULT_DEDUPE_WINDOW_SECONDS = 60

// Upper bound on ids in one batch capture operation (#394). The snapshot query
// binds one parameter per id, so this keeps a batch well under SQLite's bound-
// parameter limit; the action bar itself is sized for 2–50.
export const MAX_BATCH_CAPTURE_IDS = 500

// Dashboard cross-case activity feed (#403). The default is what the feed asks
// for; the maximum is what the repository will serve however large a limit the
// caller passes, so the query stays bounded no matter what reaches the channel.
export const RECENT_ACTIVITY_LIMIT = 10
export const MAX_RECENT_ACTIVITY_LIMIT = 50

// Signals coverage strip (#400): how many of the most recent captures each
// selector or tag row draws a cell for. The card caption states the number, so
// the two must not drift — both read this. Also the SQL bound, so the matrix
// query stays the same size whatever the case holds.
export const SIGNAL_COVERAGE_CAPTURES = 24

// How many of the most recent captures a newly created selector is backfilled
// over (selectorLifecycle). Shared rather than main-only because the note
// editor's Selector popover states the bound to the operator, and a coverage
// claim that drifts from the code behind it is worse than no claim (#391).
// Only a semantics change on an existing selector rescans without this bound.
export const RETRO_MAX_CAPTURES = 500

// Audit manifest filename, written alongside captures in each case directory.
export const MANIFEST_FILENAME = 'manifest.jsonl'

// Id-collision remap written into a case directory by archive import, and
// anchored by its `idMapSha256` in that import's signed manifest entry. Named
// here rather than in caseArchive because duplication reads it back to resolve
// a source installation's entry ids onto the local rows (#827).
export const IMPORT_ID_MAP_FILENAME = 'import-id-map.json'

// The highest manifest entry schema version this build can READ. Bump whenever
// the manifest entry schema changes (a new entry type, a new required field).
// v3 adds the `exhibit`, `derivation` and `renumber` entry types and the
// "verifier too old" outcome (ADR-0023, X25).
//
// A per-entry `schemaVersion` is the MINIMUM reader version that entry needs,
// NOT this constant: appendManifestEntry stamps each entry from the per-type
// map in manifest.ts, so a build that reads 3 keeps writing 2 on the entry
// shapes a schema-2 verifier can still read. That separation is what lets this
// reader ship before anything writes a v3 entry — a distributed verifier must
// never meet a version it cannot read before it has had the chance to update.
export const MANIFEST_SCHEMA_VERSION = 3

// Default RFC 3161 trusted-timestamp authority (#120, decision D6/#112).
// DigiCert's unauthenticated endpoint: no account/API key, and its root is
// ubiquitous in OS and court trust stores. Configurable in Settings; free TSAs
// (e.g. freetsa.org) are a documented dev/test fallback only.
export const DEFAULT_TSA_URL = 'http://timestamp.digicert.com'

// GitHub repository that hosts Birdbrain releases. Separate from the source
// repository, which is private: electron-updater's unauthenticated GitHub
// provider reads the releases Atom feed, so the feed it reads has to be public
// or every update check 404s. The updater service builds release-page URLs from
// this for the "View release" notify action, and it mirrors the
// electron-builder `publish` target in package.json.
export const GITHUB_REPO_SLUG = 'thebristolsound/birdbrain-releases'
export const GITHUB_RELEASES_URL = `https://github.com/${GITHUB_REPO_SLUG}/releases`

// Default system prompt sent with every capture analysis request. Users can
// override this from Settings → AI; this constant is the fallback on first run
// and when the stored value is blank.
export const DEFAULT_ANALYSIS_SYSTEM_PROMPT =
  'You are an expert investigative analyst reviewing web captures collected as part of a digital investigation. Analyze the provided capture in the context of the case description and metadata. Provide a clear, structured assessment covering key findings, notable entities, potential risks, and recommended next steps. Be concise but thorough.'

// <webview> partitions, shared so the renderer's attribute and the main-process
// policy that hardens it cannot drift apart. The partition is the discriminator
// the policy keys on (src/main/webviewPolicy.ts), so a renderer naming one the
// policy does not know refuses to attach rather than falling through to a
// default.
export const MHTML_PARTITION = 'mhtml-sandbox'
export const WAYBACK_PARTITION = 'wayback-replay'
// Pre-v11 `format: 'html'` captures (#906). Its own partition rather than a second
// tenant on the MHTML one: the two artefacts are stored and read differently and a
// future divergence in either policy should not have to be untangled first.
export const LEGACY_HTML_PARTITION = 'legacy-html-sandbox'

// The only URL prefix a Wayback replay guest may load or navigate to.
export const WAYBACK_REPLAY_PREFIX = 'https://web.archive.org/web/'

// The bundled demonstration Case Archive (#405). It ships as an ordinary
// chain-verified .birdbrain archive under resources/ (electron-builder copies
// it into the packaged app's resources directory alongside the extension) and
// is imported through the normal inspect/import path on first launch.
export const DEMO_CASE_ARCHIVE_FILENAME = 'demo-case.birdbrain'

// The attribution baked into the fixture and recorded on its import custody
// entry (#405, R7/Q3). A fixed string on BOTH sides: the machine that built the
// archive contributes no operator identity to it, and the operator-name gate
// that protects real archives stays intact rather than being relaxed for the
// seeding path.
export const DEMO_CASE_OPERATOR_NAME = 'Birdbrain demo fixture'
