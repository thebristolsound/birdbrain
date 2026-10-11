// FTS5 reads an unquoted term as query syntax, so a search box entry such as
// `example.com` or `alice@example.org` is a syntax error rather than a search
// (#1590). Plain words, quoted phrases, the operators and a trailing `*`
// prefix pass through unchanged; any other term becomes an exact phrase.

const OPERATORS = new Set(['AND', 'OR', 'NOT', 'NEAR'])

// The FTS5 bareword characters a user can type: ASCII letters, digits,
// underscore and any non-ASCII character. A trailing `*` is a prefix search.
const BAREWORD = /^[A-Za-z0-9_\u0080-\uFFFF]+\*?$/

// A complete quoted phrase, with embedded quotes doubled, optionally a prefix.
const QUOTED_PHRASE = /^"(?:[^"]|"")*"\*?$/

// Whitespace separates terms, except inside double quotes, so that
// `"exact phrase"` stays one term. An unclosed quote runs to the end.
function splitTerms(query: string): string[] {
  const terms: string[] = []
  let current = ''
  let inQuote = false
  for (const ch of query) {
    if (ch === '"') inQuote = !inQuote
    if (!inQuote && /\s/.test(ch)) {
      if (current) terms.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  if (current) terms.push(current)
  return terms
}

export function toFtsMatchQuery(query: string): string {
  return splitTerms(query)
    .map((term) =>
      OPERATORS.has(term) || BAREWORD.test(term) || QUOTED_PHRASE.test(term)
        ? term
        : `"${term.replace(/"/g, '""')}"`
    )
    .join(' ')
}
