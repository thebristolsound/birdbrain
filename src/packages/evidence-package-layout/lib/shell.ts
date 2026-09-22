// The Package Layout as POSIX sh, for `verify.sh` to embed. Each helper is the
// sh form of the function of the same name in paths.ts, and the package's
// tests run them through /bin/sh and /bin/bash against the TS originals, so
// the script cannot name a member the binary verifier would not.

import {
  CAPTURE_PACKAGE_DIRECTORY,
  PACKAGE_ROOT_FILES,
  SCREENSHOT_PACKAGE_DIRECTORY,
  TIMESTAMP_PACKAGE_DIRECTORY,
  capturePagePath,
  screenshotPath,
  timestampTokenPath
} from './paths'

/** The sh variable each root document is reachable through. */
export const SHELL_ROOT_FILE_VARS = Object.freeze({
  manifest: 'MANIFEST_FILE',
  signingPublicKey: 'SIGNING_KEY_FILE',
  evidenceIndex: 'EVIDENCE_INDEX_FILE',
  exportEntry: 'EXPORT_ENTRY_FILE',
  tsaRoot: 'TSA_ROOT',
  tsaIntermediates: 'TSA_INTERMEDIATES'
})

/** The sh variable each package directory is reachable through. */
export const SHELL_DIRECTORY_VARS = Object.freeze({
  pages: 'PAGES_DIR',
  screenshots: 'SCREENSHOTS_DIR',
  timestamps: 'TIMESTAMPS_DIR'
})

/** The sh helpers, one per TS path function. */
export const SHELL_PATH_HELPERS = Object.freeze({
  capturePagePath: 'capture_page_path',
  screenshotPath: 'screenshot_path',
  timestampTokenPath: 'timestamp_token_path',
  inCasePath: 'in_case_path'
})

// A helper's printf format is derived from the TS function by feeding it a
// marker and keeping what follows, so the extension a helper prints is the
// one the TS function prints and not a second spelling. The directory is
// proven by the package's sh-equivalence test.
function printfFormat(render: (id: string) => string, directoryVar: string): string {
  const marker = '\u0000'
  const tail = render(marker).split(marker)[1]
  return `'%s/%s${tail}' "$${directoryVar}" "$1"`
}

/**
 * The sh block `verify.sh` embeds before its first check: the root documents
 * and directories as variables, and one function per TS path function.
 * POSIX sh with no bashisms, like the script that hosts it.
 */
export function renderShellPathHelpers(): string {
  const lines = [
    '# Where each member of this package sits. Rendered from the Package Layout',
    '# module the binary verifier and the exporter share, so this script cannot',
    '# name a member differently from either.',
    `${SHELL_ROOT_FILE_VARS.manifest}=${PACKAGE_ROOT_FILES.manifest}`,
    `${SHELL_ROOT_FILE_VARS.signingPublicKey}=${PACKAGE_ROOT_FILES.signingPublicKey}`,
    `${SHELL_ROOT_FILE_VARS.evidenceIndex}=${PACKAGE_ROOT_FILES.evidenceIndex}`,
    `${SHELL_ROOT_FILE_VARS.exportEntry}=${PACKAGE_ROOT_FILES.exportEntry}`,
    `${SHELL_ROOT_FILE_VARS.tsaRoot}=${PACKAGE_ROOT_FILES.tsaRoot}`,
    `${SHELL_ROOT_FILE_VARS.tsaIntermediates}=${PACKAGE_ROOT_FILES.tsaIntermediates}`,
    `${SHELL_DIRECTORY_VARS.pages}=${CAPTURE_PACKAGE_DIRECTORY}`,
    `${SHELL_DIRECTORY_VARS.screenshots}=${SCREENSHOT_PACKAGE_DIRECTORY}`,
    `${SHELL_DIRECTORY_VARS.timestamps}=${TIMESTAMP_PACKAGE_DIRECTORY}`,
    `${SHELL_PATH_HELPERS.capturePagePath}() { printf ${printfFormat(capturePagePath, SHELL_DIRECTORY_VARS.pages)}; }`,
    `${SHELL_PATH_HELPERS.screenshotPath}() { printf ${printfFormat(screenshotPath, SHELL_DIRECTORY_VARS.screenshots)}; }`,
    `${SHELL_PATH_HELPERS.timestampTokenPath}() { printf ${printfFormat(timestampTokenPath, SHELL_DIRECTORY_VARS.timestamps)}; }`,
    '',
    '# The part of a storage path that lies inside the Case directory:',
    '# "<caseId>/documents/x.pdf" -> "documents/x.pdf", which is where the package',
    '# holds it. The first segment is dropped rather than matched against a case id',
    "# because an imported Case keeps the source Case's path in its signed entries.",
    '#',
    "# Backslashes are normalized first, exactly as the binary verifier's",
    '# inCasePath does: the store writes platform-native paths, so a Case built on',
    '# Windows signs "<caseId>\\documents\\x.pdf" while the package holds',
    '# "documents/x.pdf". Stripping only up to a "/" left that path whole and',
    '# reported every enclosed file of such a package missing.',
    `${SHELL_PATH_HELPERS.inCasePath}() {`,
    "  icp_path=$(printf '%s' \"$1\" | tr '\\\\' '/')",
    '  printf \'%s\' "${icp_path#*/}"',
    '}'
  ]
  return lines.join('\n')
}
