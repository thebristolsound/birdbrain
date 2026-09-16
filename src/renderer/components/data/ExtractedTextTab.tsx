import { useMemo } from 'react'

export interface HighlightTerm {
  pattern: string
  isRegex: boolean
}

interface ExtractedTextTabProps {
  text: string
  // The selected Keyword Hit, when the table is filtered by one (X39). The
  // highlight is live from the Selector; nothing is stored per match.
  highlight?: HighlightTerm
}

interface Segment {
  text: string
  hit: boolean
}

function escapeRegex(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function highlightRegex(term: HighlightTerm | undefined): RegExp | null {
  if (!term || !term.pattern) return null
  try {
    return new RegExp(term.isRegex ? term.pattern : escapeRegex(term.pattern), 'gi')
  } catch {
    return null
  }
}

export function splitLine(line: string, re: RegExp | null): Segment[] {
  if (!re) return [{ text: line, hit: false }]
  const segments: Segment[] = []
  let last = 0
  re.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = re.exec(line)) !== null) {
    if (match[0].length === 0) {
      re.lastIndex += 1
      continue
    }
    if (match.index > last) segments.push({ text: line.slice(last, match.index), hit: false })
    segments.push({ text: match[0], hit: true })
    last = match.index + match[0].length
  }
  if (last < line.length) segments.push({ text: line.slice(last), hit: false })
  return segments.length > 0 ? segments : [{ text: line, hit: false }]
}

// The Capture's extracted text, numbered by line. The text is the `.txt`
// sidecar the chain binds through `textHash`; nothing here re-extracts.
export function ExtractedTextTab({ text, highlight }: ExtractedTextTabProps) {
  const re = useMemo(() => highlightRegex(highlight), [highlight])
  const lines = useMemo(() => text.split(/\r?\n/), [text])
  return (
    <div className="py-3 pb-6" data-testid="extracted-text-tab">
      {lines.map((line, index) => (
        <div key={index} className="flex gap-3.5 px-4 leading-[1.75]">
          <span className="w-[34px] shrink-0 text-right font-mono text-[11px] text-text-faint opacity-60">
            {index + 1}
          </span>
          <span className="whitespace-pre-wrap break-words font-mono text-xs text-text-secondary">
            {splitLine(line, re).map((segment, i) =>
              segment.hit ? (
                <mark
                  key={i}
                  className="rounded-sm bg-warning-surface px-0.5 text-warning-fg"
                  data-testid="text-hit"
                >
                  {segment.text}
                </mark>
              ) : (
                <span key={i}>{segment.text}</span>
              )
            )}
          </span>
        </div>
      ))}
    </div>
  )
}
