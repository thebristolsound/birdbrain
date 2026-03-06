import { sendPrompt } from './openrouter'
import { buildEntityGraph } from './relationships'
import * as db from '@main/services/database'
import type { CaseAnalysisResult } from '@shared/types'

const ANALYSIS_PROMPT = `You are an OSINT investigation analyst for the Birdbrain investigation tool.

Analyze the following entity graph and capture data from a web investigation case. Identify patterns, connections, and investigative leads.

Respond with ONLY valid JSON in this exact format:
{
  "clusters": [
    {
      "name": "Descriptive cluster name",
      "entities": ["entity1", "entity2"],
      "summary": "How these entities are connected"
    }
  ],
  "timeline": [
    {
      "observation": "What happened chronologically",
      "significance": "Why this matters"
    }
  ],
  "suggestions": [
    {
      "type": "investigate",
      "description": "Specific actionable suggestion",
      "relatedCaptures": []
    }
  ],
  "summary": "Overall case summary and key findings"
}

Focus on:
- Groups of related entities (people connected to organizations, emails to domains)
- Temporal patterns (when entities first/last appeared, activity spikes)
- Anomalies or gaps worth investigating
- Specific, actionable next steps

Do not include any text before or after the JSON.`

export async function analyzeCase(caseId: string): Promise<CaseAnalysisResult> {
  const caseData = db.getCase(caseId)
  if (!caseData) throw new Error(`Case not found: ${caseId}`)

  const graph = buildEntityGraph(caseId)
  const captures = db.listCaptures(caseId)

  // Build context for the LLM
  const entitySummary = graph.nodes
    .map((n) => `- [${n.type}] "${n.value}" (seen ${n.occurrences}x, in ${n.captureIds.length} captures)`)
    .join('\n')

  const edgeSummary = graph.edges
    .slice(0, 50) // Limit edges
    .map((e) => `- "${e.source}" <-> "${e.target}" (co-occurred ${e.weight}x)`)
    .join('\n')

  const captureSummary = captures
    .slice(0, 100) // Limit captures
    .map((c) => `- [${c.timestamp}] ${c.title} (${c.url})`)
    .join('\n')

  const userMessage = `Case: "${caseData.name}"
${caseData.description ? `Description: ${caseData.description}` : ''}

ENTITIES (${graph.nodes.length} unique):
${entitySummary || 'No entities extracted yet.'}

CONNECTIONS (${graph.edges.length} co-occurrences):
${edgeSummary || 'No connections found.'}

CAPTURES (${captures.length} total, chronological):
${captureSummary || 'No captures.'}`

  const result = await sendPrompt([
    { role: 'system', content: ANALYSIS_PROMPT },
    { role: 'user', content: userMessage }
  ])

  // Parse response
  let analysis = parseAnalysisResponse(result.content)

  if (!analysis) {
    // Retry once
    const retry = await sendPrompt([
      { role: 'system', content: ANALYSIS_PROMPT },
      { role: 'user', content: userMessage },
      { role: 'assistant', content: result.content },
      { role: 'user', content: 'Your response was not valid JSON. Please respond with ONLY valid JSON.' }
    ])
    analysis = parseAnalysisResponse(retry.content)
  }

  if (!analysis) {
    analysis = {
      clusters: [],
      timeline: [],
      suggestions: [],
      summary: 'Analysis could not be completed. The AI model did not return valid results.'
    }
  }

  // Cache in database
  db.insertCaseAnalysis({
    caseId,
    modelUsed: db.getDb() ? undefined : undefined, // Will use settings model
    result: JSON.stringify(analysis),
    tokenUsage: result.usage.totalTokens
  })

  return analysis
}

export function getCachedAnalysis(caseId: string): CaseAnalysisResult | null {
  const cached = db.getCaseAnalysis(caseId)
  if (!cached) return null
  try {
    return JSON.parse(cached.result) as CaseAnalysisResult
  } catch {
    return null
  }
}

export function parseAnalysisResponse(content: string): CaseAnalysisResult | null {
  try {
    const parsed = JSON.parse(content)
    if (parsed.summary !== undefined) return parsed
    return null
  } catch {
    // Try extracting from code fences
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[1].trim())
        if (parsed.summary !== undefined) return parsed
      } catch {
        // fall through
      }
    }

    // Try finding JSON object
    const braceMatch = content.match(/\{[\s\S]*\}/)
    if (braceMatch) {
      try {
        const cleaned = braceMatch[0].replace(/,\s*([\]}])/g, '$1')
        const parsed = JSON.parse(cleaned)
        if (parsed.summary !== undefined) return parsed
      } catch {
        // fall through
      }
    }

    return null
  }
}
