// The evidence-affecting include list, read from the document that owns it:
// docs/specs/2026-07-31-evidence-affecting-paths-assessment.md, section "Include list". Every
// table row there is `| \`path\` | tier | why |`; the section ends at "## Notable exclusions".
// Reading the document keeps one source; a copied list would drift the way ADR-0014 measured.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export const INCLUDE_LIST_DOC = 'docs/specs/2026-07-31-evidence-affecting-paths-assessment.md'
const TIERS = new Set(['blocking', 'advisory'])

export function parseIncludeList(markdown) {
  const start = markdown.indexOf('\n## Include list')
  const end = markdown.indexOf('\n## Notable exclusions')
  if (start < 0 || end < 0 || end < start) throw new Error('include list section not found')
  const entries = []
  for (const line of markdown.slice(start, end).split('\n')) {
    const cells = line.split('|').map((c) => c.trim())
    if (cells.length < 4) continue
    const path = cells[1].match(/^`([^`]+)`$/)?.[1]
    const tier = cells[2]
    if (!path || !TIERS.has(tier)) continue
    entries.push({ path, tier, why: cells[3] })
  }
  if (!entries.length) throw new Error('include list parsed to zero entries')
  return entries
}

// `**` spans directories, `*` stays inside one segment, everything else is literal.
export const globToRegExp = (glob) =>
  new RegExp(
    `^${glob
      .split('**')
      .map((part) => part.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*'))
      .join('.*')}$`
  )

export function matchEntry(entries, filePath) {
  let best = null
  for (const entry of entries) {
    if (!globToRegExp(entry.path).test(filePath)) continue
    // Blocking wins over advisory when both match; a longer glob is the more specific claim.
    if (!best || (entry.tier === 'blocking' && best.tier !== 'blocking') || (entry.tier === best.tier && entry.path.length > best.path.length)) best = entry
  }
  return best
}

export const loadIncludeList = (root = process.cwd()) => parseIncludeList(readFileSync(join(root, INCLUDE_LIST_DOC), 'utf8'))
