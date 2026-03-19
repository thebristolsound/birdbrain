import type { ReactNode } from 'react'
import { createElement } from 'react'

export interface MatchResult {
  matchText: string
  index: number
  context: string
}

type TokenType = 'operator' | 'class' | 'quantifier' | 'bracket' | 'literal'

const TOKEN_CLASSES: Record<TokenType, string> = {
  operator: 'text-indigo-400',
  class: 'text-emerald-400',
  quantifier: 'text-amber-400',
  bracket: 'text-sky-400',
  literal: 'text-slate-200'
}

export function highlightRegexSyntax(pattern: string): ReactNode[] {
  const tokens: { text: string; type: TokenType }[] = []
  let i = 0

  while (i < pattern.length) {
    const ch = pattern[i]

    // Escape sequences
    if (ch === '\\' && i + 1 < pattern.length) {
      const next = pattern[i + 1]
      if ('dwsDWS'.includes(next)) {
        tokens.push({ text: ch + next, type: 'class' })
      } else if (next === 'b' || next === 'B') {
        tokens.push({ text: ch + next, type: 'operator' })
      } else {
        tokens.push({ text: ch + next, type: 'literal' })
      }
      i += 2
      continue
    }

    // Operators
    if ('|^$'.includes(ch) || ch === '.') {
      tokens.push({ text: ch, type: 'operator' })
      i++
      continue
    }

    // Quantifiers
    if ('*+?'.includes(ch)) {
      tokens.push({ text: ch, type: 'quantifier' })
      i++
      continue
    }

    // Curly brace quantifiers {n} {n,} {n,m}
    if (ch === '{') {
      const end = pattern.indexOf('}', i)
      if (end !== -1 && /^\{\d+,?\d*\}$/.test(pattern.slice(i, end + 1))) {
        tokens.push({ text: pattern.slice(i, end + 1), type: 'quantifier' })
        i = end + 1
        continue
      }
    }

    // Brackets
    if ('()[]'.includes(ch)) {
      tokens.push({ text: ch, type: 'bracket' })
      i++
      continue
    }

    // Literal
    tokens.push({ text: ch, type: 'literal' })
    i++
  }

  // Merge adjacent tokens of the same type
  const merged: typeof tokens = []
  for (const token of tokens) {
    const last = merged[merged.length - 1]
    if (last && last.type === token.type) {
      last.text += token.text
    } else {
      merged.push({ ...token })
    }
  }

  return merged.map((token, idx) =>
    createElement('span', { key: idx, className: TOKEN_CLASSES[token.type] }, token.text)
  )
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
