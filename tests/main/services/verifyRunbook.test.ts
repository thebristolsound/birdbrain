import { describe, expect, it } from 'vitest'
import { buildVerifyRunbook } from '@main/services/verifyRunbook'
import { GITHUB_RELEASES_URL, MANIFEST_SCHEMA_VERSION } from '@shared/constants'

// ADR-0023: the package names the manifest schema version it needs and where a
// current verifier is, so a recipient holding an old verifier learns it from
// the paperwork rather than from the run (#1172).

const SECTION = '## Manifest schema version'

const render = (
  requiredSchemaVersion: number,
  readerSchemaVersion = MANIFEST_SCHEMA_VERSION,
  appVersion = '1.2.3-beta.4'
): string => buildVerifyRunbook({ requiredSchemaVersion, readerSchemaVersion, appVersion })

// The runbook wraps prose at any space, so the assertions read it collapsed.
const prose = (text: string): string => text.replace(/\s+/g, ' ')

// The text from the section's heading to the next heading.
const section = (runbook: string): string => {
  const start = runbook.indexOf(`\n${SECTION}\n`)
  expect(start).toBeGreaterThan(-1)
  const end = runbook.indexOf('\n## ', start + SECTION.length + 1)
  return runbook.slice(start, end)
}

describe('buildVerifyRunbook', () => {
  it("states the schema needed, the writing build's reader and the releases page", () => {
    const text = prose(section(render(2, 7, '1.2.3-beta.4')))
    expect(text).toContain('This package needs a verifier that reads manifest schema 2.')
    expect(text).toContain(
      'Birdbrain 1.2.3-beta.4 wrote this package, and that build reads manifest schema up to 7.'
    )
    expect(text).toContain(`Birdbrain releases are published at ${GITHUB_RELEASES_URL}.`)
  })

  it("names the standalone verifier's too-old result as no verdict", () => {
    const text = prose(section(render(3)))
    expect(text).toContain(
      'The standalone verifier, `birdbrain-verify`, prints `RESULT: VERIFIER TOO OLD` and exits 3'
    )
    expect(text).toContain('That result is not a tamper finding and not a pass')
    // The result shipped with the reader of schema 3, so older builds do not print it.
    expect(text).toContain('Builds of the verifier that read schema 2 or below predate the result.')
  })

  // A member on a newer build can write a member chain this package encloses,
  // so the version a package needs can exceed what the build that wrote it
  // reads. The remedy names the version the package needs, never the writing
  // build, so it stays true then.
  it('keys the remedy to the schema the package needs, above what the writing build reads', () => {
    const text = prose(section(render(8, 7, '1.2.3-beta.4')))
    expect(text).toContain('This package needs a verifier that reads manifest schema 8.')
    expect(text).toContain('that build reads manifest schema up to 7.')
    expect(text).toContain('Re-run with a verifier from a Birdbrain release that reads manifest')
    expect(text).toContain('schema 8 or above.')
    expect(text).not.toContain('1.2.3-beta.4 or later')
  })

  it('states the versions before the trust model, and only there', () => {
    const runbook = render(2)
    expect(runbook.indexOf(`\n${SECTION}\n`)).toBeLessThan(runbook.indexOf('\n## Trust model'))
    // Every other line is the same for every package, so a test that reads the
    // rest of the runbook can render it with any versions.
    const rest = (text: string): string => text.replace(section(text), '')
    expect(rest(render(2, 7, '1.0.0'))).toBe(rest(render(9, 8, '2.0.0')))
  })

  it('adds no command, so the section is prose a reader runs nothing from', () => {
    expect(section(render(2))).not.toContain('```')
  })

  it('keeps the trust model rule that an entry at schema 2 or above is signed', () => {
    expect(prose(render(3))).toContain(
      'Entries with `schemaVersion` 2 or above additionally carry an RSA `signature` ' +
        'over that hash.'
    )
  })
})
