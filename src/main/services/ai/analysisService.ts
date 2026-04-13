import { readFile } from 'fs/promises'
import { getCapture, getCase } from '@main/services/database'
import { sendPrompt, truncateForContext } from '@main/services/openrouter'
import { getCapturePath } from '@main/services/storage'
import { MAX_ANALYSIS_TEXT_BYTES } from '@shared/constants'

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
  contextLength?: number
  signal?: AbortSignal
}): Promise<AnalyzeResult> {
  const capture = getCapture(opts.captureId)
  if (!capture) throw new Error(`Capture not found: ${opts.captureId}`)

  const caseRow = getCase(opts.caseId)

  const textContent = await readCaptureText(opts.caseId, opts.captureId)

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
    // Leave headroom for system prompt, metadata, and completion. The model
    // context length is in tokens; a conservative chars-per-token ratio of 3
    // keeps us well under the window even for short-token languages.
    const maxChars = opts.contextLength ? Math.floor(opts.contextLength * 3 * 0.6) : 100_000
    parts.push(truncateForContext(textContent, maxChars))
  } else {
    parts.push('[No text content available for this capture]')
  }

  const result = await sendPrompt(
    [
      { role: 'system', content: opts.systemPrompt },
      { role: 'user', content: parts.join('\n') }
    ],
    opts.model,
    opts.apiKey,
    opts.signal
  )

  return {
    content: result.content,
    tokenUsage: {
      prompt: result.usage.promptTokens,
      completion: result.usage.completionTokens,
      total: result.usage.totalTokens
    }
  }
}

async function readCaptureText(caseId: string, captureId: string): Promise<string> {
  const path = getCapturePath(caseId, captureId, 'txt')
  try {
    const buf = await readFile(path)
    if (buf.byteLength <= MAX_ANALYSIS_TEXT_BYTES) return buf.toString('utf-8')
    return (
      buf.subarray(0, MAX_ANALYSIS_TEXT_BYTES).toString('utf-8') +
      '\n\n[Content truncated at size cap]'
    )
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return ''
    throw err
  }
}
