import { v4 as uuid } from 'uuid'
// eslint-disable-next-line no-restricted-imports -- owns the capture_analyses aggregate's SQL; repo home resolved by 2026-07-11-capture-row-ownership plan
import { getDb } from '@main/services/db/core'
import { sendPrompt, truncateForContext } from '@main/services/ai/openrouter'
import { defaultCaptureStore } from '@main/services/captureStore'
import type { CaptureAnalysis, TokenUsage } from '@shared/types'

interface AnalyzeResult {
  content: string
  tokenUsage: TokenUsage
}

export async function analyzeCapture(
  captureId: string,
  caseId: string,
  model: string,
  apiKey: string,
  systemPrompt: string
): Promise<AnalyzeResult> {
  const db = getDb()

  // Load capture metadata
  const capture = db.prepare('SELECT * FROM captures WHERE id = ?').get(captureId) as
    | Record<string, unknown>
    | undefined
  if (!capture) throw new Error(`Capture not found: ${captureId}`)

  const captureCaseId = capture.case_id
  if (typeof captureCaseId !== 'string' || captureCaseId.length === 0) {
    throw new Error(`Capture has invalid case association: ${captureId}`)
  }
  if (captureCaseId !== caseId) {
    throw new Error(`Capture ${captureId} does not belong to case ${caseId}`)
  }

  // Load case context
  const caseRow = db.prepare('SELECT * FROM cases WHERE id = ?').get(captureCaseId) as
    | Record<string, unknown>
    | undefined

  // Load text content
  const textBuffer = defaultCaptureStore.readArtifact(captureCaseId, captureId, 'txt')
  const textContent = textBuffer ? textBuffer.toString('utf-8') : ''

  // Build user message
  const parts: string[] = []

  if (caseRow) {
    parts.push('## Case Context')
    parts.push(`Name: ${caseRow.name ?? ''}`)
    if (caseRow.description) parts.push(`Description: ${caseRow.description}`)
    if (caseRow.type) parts.push(`Type: ${caseRow.type}`)
    parts.push('')
  }

  parts.push('## Capture Metadata')
  parts.push(`URL: ${capture.url ?? ''}`)
  if (capture.title) parts.push(`Title: ${capture.title}`)
  parts.push(`Captured: ${capture.timestamp ?? ''}`)
  if (capture.format) parts.push(`Format: ${capture.format}`)
  if (capture.http_status) parts.push(`HTTP Status: ${capture.http_status}`)
  if (capture.operator_name) parts.push(`Operator: ${capture.operator_name}`)
  parts.push('')

  if (textContent) {
    parts.push('## Capture Content')
    parts.push(truncateForContext(textContent))
  } else {
    parts.push('## Capture Content')
    parts.push('[No text content available for this capture]')
  }

  const userMessage = parts.join('\n')

  const result = await sendPrompt(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage }
    ],
    model,
    apiKey
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

export function saveAnalysis(analysis: CaptureAnalysis): void {
  const db = getDb()
  db.prepare(
    `INSERT INTO capture_analyses (id, capture_id, case_id, content, model, token_usage, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(capture_id) DO UPDATE SET
       content = excluded.content,
       model = excluded.model,
       token_usage = excluded.token_usage,
       updated_at = excluded.updated_at`
  ).run(
    analysis.id || uuid(),
    analysis.captureId,
    analysis.caseId,
    analysis.content,
    analysis.model,
    JSON.stringify(analysis.tokenUsage),
    analysis.createdAt || new Date().toISOString(),
    analysis.updatedAt || new Date().toISOString()
  )
}

export function getAnalysis(captureId: string): CaptureAnalysis | null {
  const db = getDb()
  const row = db.prepare('SELECT * FROM capture_analyses WHERE capture_id = ?').get(captureId) as
    | Record<string, unknown>
    | undefined
  if (!row) return null

  let tokenUsage: TokenUsage = { prompt: 0, completion: 0, total: 0 }
  try {
    if (typeof row.token_usage === 'string') {
      tokenUsage = JSON.parse(row.token_usage) as TokenUsage
    }
  } catch {
    /* malformed JSON — use defaults */
  }

  return {
    id: row.id as string,
    captureId: row.capture_id as string,
    caseId: row.case_id as string,
    content: row.content as string,
    model: row.model as string,
    tokenUsage,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string
  }
}
