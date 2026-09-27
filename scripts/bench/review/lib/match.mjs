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

// A finding that names the file but no line matches when the file holds
// exactly one candidate: the claim is unambiguous, and the missing line is
// counted by the claim check rather than by recall.
function inRange(entry, line, window, alone = false) {
  if (entry.lineStart === undefined && entry.lineEnd === undefined) return true
  if (line === undefined || line === null) return alone
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
      .filter(({ d }) => {
        if (normalizePath(d.file) !== file) return false
        const alone = truth.defects.filter((x) => normalizePath(x.file) === file).length === 1
        return inRange(d, f.line, window, alone)
      })
      .sort((a, b) => distance(a.d, f.line) - distance(b.d, f.line))
    if (candidates.length > 0) {
      matches.push({ defectId: candidates[0].d.id, findingIndex })
      return
    }
    const refutedIndex = truth.refuted.findIndex((r) => {
      if (normalizePath(r.file) !== file) return false
      const alone = truth.refuted.filter((x) => normalizePath(x.file) === file).length === 1
      return inRange(r, f.line, window, alone)
    })
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
