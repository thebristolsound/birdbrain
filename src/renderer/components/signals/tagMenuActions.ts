import type { Capture } from '@shared/types'

export function duplicateTagName(name: string, existingNames: string[]): string {
  const used = new Set(existingNames)
  let candidate = `${name}-copy`
  let suffix = 2
  while (used.has(candidate)) candidate = `${name}-copy-${suffix++}`
  return candidate
}

function markdownCell(value: string): string {
  return value.replace(/[\\`*_{}[\]()#+.!|<>]/g, '\\$&').replace(/[\r\n]+/g, ' ')
}

export function tagCapturesMarkdown(name: string, captures: Capture[]): string {
  return [
    `# ${markdownCell(name)}`,
    '',
    'Capture references only. This is not a verified evidence package.',
    '',
    '| Title | URL | Captured at | SHA-256 |',
    '| --- | --- | --- | --- |',
    ...captures.map(
      (capture) =>
        `| ${[capture.title, capture.url, capture.timestamp, capture.hash].map(markdownCell).join(' | ')} |`
    )
  ].join('\n')
}
