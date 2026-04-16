import { getCapture, getCase, getCaptureTextContent } from '@main/services/database'
import { sendPrompt } from '@main/services/openrouter'
import { MAX_ANALYSIS_TEXT_CHARS } from '@shared/constants'

interface AnalyzeResult {
  content: string
  tokenUsage: { prompt: number; completion: number; total: number }
}

export async function analyzeCapture(opts: {
  captureId: string
  caseId: string
  model: string
  apiKey: string
  systemPrompt: string
}): Promise<AnalyzeResult> {
  const capture = getCapture(opts.captureId)
  if (!capture) throw new Error(`Capture not found: ${opts.captureId}`)
  if (capture.caseId !== opts.caseId) {
    throw new Error(`Capture ${opts.captureId} does not belong to case ${opts.caseId}`)
  }

  const caseRow = getCase(opts.caseId)
  const textContent = getCaptureTextContent(opts.captureId) ?? ''

  const parts: string[] = []

  if (caseRow) {
    parts.push('## Case Context')
    parts.push(`Name: ${caseRow.name}`)
    if (caseRow.description) parts.push(`Description: ${caseRow.description}`)
    if (caseRow.type) parts.push(`Type: ${caseRow.type}`)
    parts.push('')
  }

  parts.push('## Capture Metadata')
  parts.push(`URL: ${capture.url}`)
  if (capture.title) parts.push(`Title: ${capture.title}`)
  parts.push(`Captured: ${capture.timestamp}`)
  parts.push(`Format: ${capture.format}`)
  if (capture.httpStatus) parts.push(`HTTP Status: ${capture.httpStatus}`)
  if (capture.operatorName) parts.push(`Operator: ${capture.operatorName}`)
  parts.push('')

  parts.push('## Capture Content')
  if (textContent) {
    parts.push(truncate(textContent, MAX_ANALYSIS_TEXT_CHARS))
  } else {
    parts.push('[No text content available for this capture]')
  }

  const result = await sendPrompt(
    [
      { role: 'system', content: opts.systemPrompt },
      { role: 'user', content: parts.join('\n') }
    ],
    opts.model,
    opts.apiKey
  )

  return { content: result.content, tokenUsage: result.usage }
}

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  return text.slice(0, maxChars) + '\n\n[Content truncated for model context window]'
}
