// Windows is the strictest target: it rejects <>:"/\|?* and control chars,
// trailing dots/spaces, and the legacy device names — a page title like
// `Foo: bar | Site?` fails the save dialog outright. Sanitize once here so every
// dialog defaultPath is valid on Windows, macOS and Linux alike.
// eslint-disable-next-line no-control-regex
const ILLEGAL_CHARS = /[<>:"/\\|?*\x00-\x1f]+/g
const RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i

export const MAX_FILENAME_STEM_LENGTH = 100

/**
 * Turns free text (page title, case name) into a filename stem that every
 * desktop OS accepts. Unicode letters are kept; only structurally illegal
 * characters are replaced. Returns `fallback` when nothing usable remains.
 */
export function safeFilename(
  input: string | null | undefined,
  fallback = 'file',
  maxLength = MAX_FILENAME_STEM_LENGTH
): string {
  let stem = (input ?? '').normalize('NFC').replace(ILLEGAL_CHARS, ' ').replace(/\s+/g, ' ').trim()
  if (stem.length > maxLength) {
    stem = stem.slice(0, maxLength)
    // slice counts UTF-16 code units, so a cut inside a surrogate pair leaves
    // its high half behind; drop it so the whole character goes.
    if (/[\uD800-\uDBFF]$/.test(stem)) stem = stem.slice(0, -1)
    stem = stem.trim()
  }
  // Windows strips trailing dots and spaces itself, which changes the name the
  // user saw in the dialog; do it up front so what is shown is what is written.
  stem = stem.replace(/[. ]+$/g, '')
  // A device name stays reserved with an extension after it (NUL.txt), and
  // every caller appends one, so the part before the first dot decides.
  if (!stem || RESERVED_NAMES.test(stem.split('.')[0])) return fallback
  return stem
}
