export interface MatchResult {
  matchText: string
  index: number
  context: string
}

export function testPatternAgainstText(
  pattern: string,
  isRegex: boolean,
  text: string,
  maxMatches = 50
): MatchResult[] {
  const results: MatchResult[] = []

  if (isRegex) {
    let re: RegExp
    try {
      re = new RegExp(pattern, 'gi')
    } catch {
      return []
    }

    let match: RegExpExecArray | null
    while ((match = re.exec(text)) !== null && results.length < maxMatches) {
      const start = Math.max(0, match.index - 25)
      const end = Math.min(text.length, match.index + match[0].length + 25)
      results.push({
        matchText: match[0],
        index: match.index,
        context: text.slice(start, end)
      })
      if (match[0].length === 0) re.lastIndex++
    }
  } else {
    const lowerText = text.toLowerCase()
    const lowerPattern = pattern.toLowerCase()
    let pos = 0

    while (pos < text.length && results.length < maxMatches) {
      const idx = lowerText.indexOf(lowerPattern, pos)
      if (idx === -1) break
      const start = Math.max(0, idx - 25)
      const end = Math.min(text.length, idx + pattern.length + 25)
      results.push({
        matchText: text.slice(idx, idx + pattern.length),
        index: idx,
        context: text.slice(start, end)
      })
      pos = idx + Math.max(1, pattern.length)
    }
  }

  return results
}
