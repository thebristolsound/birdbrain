import { sendPrompt, truncateForContext } from './openrouter'
import * as db from '@main/services/database'
import { readCaptureFile } from '@main/services/storage'
import type { Entity, EntityType } from '@shared/types'

interface ExtractedEntity {
  type: EntityType
  value: string
  context?: string
  confidence?: number
}

const EXTRACTION_PROMPT = `You are an OSINT entity extraction assistant for the Birdbrain investigation tool.

Analyze the following web page text content and extract all identifiable entities.

Entity types to extract:
- person: Names, handles, usernames
- organization: Companies, agencies, groups
- email: Email addresses
- phone: Phone numbers
- domain: Web domains
- ip_address: IP addresses
- address: Physical addresses
- date: Dates, deadlines, events
- username: Social media handles, usernames
- crypto_wallet: Cryptocurrency wallet addresses

Respond with ONLY valid JSON in this exact format:
{
  "entities": [
    {
      "type": "person",
      "value": "John Smith",
      "context": "...surrounding text where entity was found...",
      "confidence": 0.95
    }
  ]
}

If no entities are found, respond with: {"entities": []}
Do not include any text before or after the JSON.`

export function shouldSkipEntity(
  type: string,
  value: string,
  existingEntities: Array<{ type: string; value: string }>
): boolean {
  return existingEntities.some(e => e.type === type && e.value === value)
}

export async function extractEntities(captureId: string): Promise<Entity[]> {
  console.log(`[AI] Starting entity extraction for capture ${captureId}`)

  const capture = db.getCapture(captureId)
  if (!capture) throw new Error(`Capture not found: ${captureId}`)

  // Read text content
  const textBuffer = readCaptureFile(capture.caseId, captureId, 'txt')
  const text = textBuffer?.toString('utf-8')
  if (!text?.trim()) {
    console.warn(`[AI] No text content found for capture ${captureId} — cannot extract entities`)
    throw new Error('No text content available for this capture. The page may not have had extractable text.')
  }

  console.log(`[AI] Text content loaded (${text.length} chars), sending to LLM...`)
  const truncatedText = truncateForContext(text)

  // Send to LLM
  let result = await sendPrompt([
    { role: 'system', content: EXTRACTION_PROMPT },
    { role: 'user', content: truncatedText }
  ])
  console.log(`[AI] LLM response received (${result.content.length} chars)`)

  // Parse response
  let entities = parseEntitiesResponse(result.content)

  // Retry once if JSON is malformed
  if (!entities) {
    console.warn(`[AI] Failed to parse LLM response, retrying...`)
    console.warn(`[AI] Raw response: ${result.content.slice(0, 500)}`)
    result = await sendPrompt([
      { role: 'system', content: EXTRACTION_PROMPT },
      { role: 'user', content: truncatedText },
      { role: 'assistant', content: result.content },
      { role: 'user', content: 'Your response was not valid JSON. Please respond with ONLY valid JSON matching the specified format.' }
    ])
    entities = parseEntitiesResponse(result.content)
    if (!entities) {
      console.error(`[AI] Retry also failed to parse. Raw: ${result.content.slice(0, 500)}`)
      throw new Error('Failed to parse AI response as valid JSON after retry')
    }
  }

  console.log(`[AI] Parsed ${entities.length} entities from response`)
  if (entities.length === 0) return []

  // Clear existing AI entities for this capture (preserve rule-based ones)
  db.deleteEntitiesByCaptureAndSource(captureId, 'ai')
  const existingRuleEntities = db.getEntitiesByCaptureAndSource(captureId, 'rule')

  // Store in database
  const stored: Entity[] = []
  for (const entity of entities) {
    if (!isValidEntityType(entity.type) || !entity.value?.trim()) continue
    if (shouldSkipEntity(entity.type, entity.value.trim(), existingRuleEntities)) continue
    const saved = db.insertEntity({
      captureId,
      type: entity.type,
      value: entity.value.trim(),
      context: entity.context?.trim(),
      confidence: typeof entity.confidence === 'number' ? Math.min(1, Math.max(0, entity.confidence)) : undefined,
      source: 'ai'
    })
    stored.push(saved)
  }

  console.log(`[AI] Stored ${stored.length} entities in database`)
  return stored
}

export function parseEntitiesResponse(content: string): ExtractedEntity[] | null {
  try {
    // Try direct parse first
    const parsed = JSON.parse(content)
    if (Array.isArray(parsed.entities)) return parsed.entities
    if (Array.isArray(parsed)) return parsed
    return null
  } catch {
    // Try extracting JSON from code fences or surrounding text
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[1].trim())
        if (Array.isArray(parsed.entities)) return parsed.entities
        if (Array.isArray(parsed)) return parsed
      } catch {
        // fall through
      }
    }

    // Try finding JSON object in text
    const braceMatch = content.match(/\{[\s\S]*\}/)
    if (braceMatch) {
      try {
        // Fix trailing commas
        const cleaned = braceMatch[0].replace(/,\s*([\]}])/g, '$1')
        const parsed = JSON.parse(cleaned)
        if (Array.isArray(parsed.entities)) return parsed.entities
      } catch {
        // fall through
      }
    }

    return null
  }
}

const VALID_ENTITY_TYPES: Set<string> = new Set([
  'person', 'organization', 'email', 'phone', 'domain',
  'ip_address', 'address', 'date', 'username', 'crypto_wallet', 'custom'
])

function isValidEntityType(type: string): type is EntityType {
  return VALID_ENTITY_TYPES.has(type)
}
