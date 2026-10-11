// FTS5 reads an unquoted term as query syntax, so a search box entry such as
// `example.com` or `alice@example.org` is a syntax error rather than a search
// (#1590). The query is split the way FTS5's own lexer splits it, and only a
// word FTS5 rejects is rewritten, as an exact phrase: one holding a character
// outside FTS5's query alphabet, or a hyphen inside a word. Everything else
// passes through byte for byte, so plain words, quoted phrases, operators,
// column filters, NEAR groups and parentheses keep their meaning, and a
// malformed query such as `foo AND` still fails.

// FTS5 separates tokens on these four characters only.
const WHITESPACE = new Set([' ', '\t', '\n', '\r'])

// FTS5 reads each of these as a token of its own, ending the word before it.
const DELIMITERS = new Set(['(', ')', '{', '}', ','])

// FTS5's bareword characters: ASCII letters, digits, underscore, 0x1A and any
// non-ASCII character.
const BW = '[A-Za-z0-9_\\x1A\\u0080-\\uFFFF]'

// A word built only from bareword characters and the operator characters FTS5
// accepts inside a word run. Anything else in a word is an FTS5 syntax error.
const READABLE_WORD = new RegExp(`^(?:${BW}|[:*^+-])*$`)

function isBoundary(ch: string): boolean {
  return WHITESPACE.has(ch) || DELIMITERS.has(ch) || ch === '"'
}

// Index of the quote closing the string opened at `start`, or -1 when the
// string runs to the end. A doubled quote inside a string is a literal quote.
function closingQuote(query: string, start: number): number {
  for (let i = start + 1; i < query.length; i++) {
    if (query[i] !== '"') continue
    if (query[i + 1] !== '"') return i
    i++
  }
  return -1
}

function phrase(text: string): string {
  return `"${text.replace(/"/g, '""')}"`
}

// FTS5 reads `-` only as the start of a column exclusion such as
// `-title:acme`. Between two bareword characters and not followed by a column
// name and `:`, it is a hyphenated word (`well-known`, `2026-10-11`), which
// FTS5 rejects. A leading `-` is left alone, so `acme -fraud` still fails
// rather than quietly matching the excluded word.
function prepareWord(word: string, columns: string): string {
  const hyphenated = new RegExp(`${BW}-(?!(?:${columns}):)${BW}`, 'i')
  if (READABLE_WORD.test(word) && !hyphenated.test(word)) return word
  // Keep a leading column filter and a trailing prefix `*` as syntax, and
  // search the rest as a phrase: `title:example.com*` -> `title:"example.com"*`.
  const filter = new RegExp(`^(?:-?(?:${columns}))?:`, 'i').exec(word)?.[0] ?? ''
  const star = word.endsWith('*') ? '*' : ''
  return `${filter}${phrase(word.slice(filter.length, word.length - star.length))}${star}`
}

// `columns` names the FTS table's columns, so that a column filter in front of
// a punctuated word stays a filter.
export function toFtsMatchQuery(query: string, columns: readonly string[]): string {
  const names = columns.join('|')
  let out = ''
  // A rewritten word can end in a quote; another quote straight after it would
  // read as an escaped quote, so the two are separated by a space. A query
  // that needs no rewriting never has two such pieces next to each other.
  const append = (piece: string) => {
    out += out.endsWith('"') && piece.startsWith('"') ? ` ${piece}` : piece
  }
  let i = 0
  while (i < query.length) {
    const ch = query[i]
    if (WHITESPACE.has(ch) || DELIMITERS.has(ch)) {
      out += ch
      i++
    } else if (ch === '"') {
      const end = closingQuote(query, i)
      // An unclosed quote is an FTS5 error, so the rest becomes one phrase.
      if (end === -1) {
        append(phrase(query.slice(i)))
        break
      }
      append(query.slice(i, end + 1))
      i = end + 1
    } else {
      let end = i
      while (end < query.length && !isBoundary(query[end])) end++
      append(prepareWord(query.slice(i, end), names))
      i = end
    }
  }
  return out
}
