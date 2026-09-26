// Matches a model's findings to the truth file. A finding matches a defect on
// the same file when its line falls inside the defect's range widened by
// `window`; a defect with no line range matches on file alone. Only the first
// `cap` findings count, which is the number the verdict comment may carry.

export const DEFAULT_WINDOW = 5
export const DEFAULT_CAP = 5

export const normalizePath = (p) =>
  String(p ?? '')
    .replace(/^\.\//, '')
    .replace(/^[ab]\//, '')
    .replace(/^\/+/, '')

function inRange(entry, line, window) {
  if (entry.lineStart === undefined && entry.lineEnd === undefined) return true
  if (line === undefined || line === null) return false
  const start = (entry.lineStart ?? entry.lineEnd) - window
  const end = (entry.lineEnd ?? entry.lineStart) + window
  return line >= start && line <= end
}

const distance = (entry, line) => {
  if (line === undefined || line === null || entry.lineStart === undefined) return 0
  if (line < entry.lineStart) return entry.lineStart - line
  const end = entry.lineEnd ?? entry.lineStart
  return line > end ? line - end : 0
}

export function matchFindings(findings, truth, options = {}) {
  const window = options.window ?? DEFAULT_WINDOW
  const cap = options.cap ?? DEFAULT_CAP
  const counted = findings.slice(0, cap)
  const matches = []
  const refutedHits = []
  const unmatched = []
  counted.forEach((f, findingIndex) => {
    const file = normalizePath(f.file)
    const candidates = truth.defects
      .map((d, defectIndex) => ({ d, defectIndex }))
      .filter(({ d }) => normalizePath(d.file) === file && inRange(d, f.line, window))
      .sort((a, b) => distance(a.d, f.line) - distance(b.d, f.line))
    if (candidates.length > 0) {
      matches.push({ defectId: candidates[0].d.id, findingIndex })
      return
    }
    const refutedIndex = truth.refuted.findIndex(
      (r) => normalizePath(r.file) === file && inRange(r, f.line, window)
    )
    if (refutedIndex >= 0) refutedHits.push({ refutedIndex, findingIndex })
    else unmatched.push(findingIndex)
  })
  const matchedDefectIds = new Set(matches.map((m) => m.defectId))
  return {
    matches,
    matchedDefectIds: [...matchedDefectIds],
    refutedHits,
    unmatched,
    overCap: Math.max(0, findings.length - cap)
  }
}
