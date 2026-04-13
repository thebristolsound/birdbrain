import { getSettings } from '@main/services/settings'
import { OpenRouterResponseSchema } from '@shared/schemas'
import type { OpenRouterModel } from '@shared/types'

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1'
const MAX_RETRIES = 3
const INITIAL_BACKOFF_MS = 1000

interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface PromptResult {
  content: string
  usage: { promptTokens: number; completionTokens: number; totalTokens: number }
}

export async function testApiKey(apiKey: string): Promise<boolean> {
  try {
    const res = await fetch(`${OPENROUTER_BASE}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` }
    })
    return res.ok
  } catch {
    return false
  }
}

export async function listModels(apiKey: string): Promise<OpenRouterModel[]> {
  const res = await fetch(`${OPENROUTER_BASE}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` }
  })
  if (!res.ok) throw new Error(`OpenRouter API error: ${res.status}`)
  const data = (await res.json()) as { data?: Record<string, unknown>[] }

  return (data.data || []).map((m: Record<string, unknown>) => ({
    id: m.id as string,
    name: (m.name as string) || (m.id as string),
    contextLength: (m.context_length as number) || 0,
    pricing: {
      prompt: String((m.pricing as Record<string, unknown>)?.prompt || '0'),
      completion: String((m.pricing as Record<string, unknown>)?.completion || '0')
    }
  }))
}

export async function sendPrompt(
  messages: ChatMessage[],
  model?: string,
  apiKey?: string,
  signal?: AbortSignal
): Promise<PromptResult> {
  const settings = getSettings()
  const key = apiKey || settings.openRouterApiKey
  const modelId = model || settings.defaultModel

  if (!key) throw new Error('No OpenRouter API key configured')

  let lastError: Error | null = null

  console.log(`[OpenRouter] Sending request to model ${modelId} (${messages.length} messages)`)

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`,
          'HTTP-Referer': 'https://github.com/birdbrain',
          'X-Title': 'Birdbrain'
        },
        body: JSON.stringify({ model: modelId, messages }),
        signal
      })

      if (res.status === 429) {
        const backoff = INITIAL_BACKOFF_MS * Math.pow(2, attempt)
        console.warn(
          `[OpenRouter] Rate limited (429), retrying in ${backoff}ms (attempt ${attempt + 1}/${MAX_RETRIES})`
        )
        await new Promise((resolve) => setTimeout(resolve, backoff))
        continue
      }

      if (!res.ok) {
        const body = await res.text().catch(() => '')
        console.error(
          `[OpenRouter] API error: ${res.status} ${res.statusText} — ${body.slice(0, 300)}`
        )
        throw new Error(`OpenRouter API error: ${res.status} ${res.statusText}`)
      }

      const raw: unknown = await res.json()
      const parsed = OpenRouterResponseSchema.safeParse(raw)
      if (!parsed.success) {
        const issues = parsed.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; ')
        throw new Error(`OpenRouter response failed schema validation: ${issues}`)
      }
      const data = parsed.data
      const content = data.choices[0]?.message?.content ?? ''
      console.log(
        `[OpenRouter] Response received (${content.length} chars, ${data.usage?.total_tokens ?? '?'} tokens)`
      )

      return {
        content,
        usage: {
          promptTokens: data.usage?.prompt_tokens ?? 0,
          completionTokens: data.usage?.completion_tokens ?? 0,
          totalTokens: data.usage?.total_tokens ?? 0
        }
      }
    } catch (err) {
      lastError = err as Error
      // AbortError should not retry — propagate immediately.
      if (lastError.name === 'AbortError') throw lastError
      if (attempt < MAX_RETRIES - 1) {
        const backoff = INITIAL_BACKOFF_MS * Math.pow(2, attempt)
        console.warn(
          `[OpenRouter] Error: ${lastError.message}, retrying in ${backoff}ms (attempt ${attempt + 1}/${MAX_RETRIES})`
        )
        await new Promise((resolve) => setTimeout(resolve, backoff))
      }
    }
  }

  console.error(`[OpenRouter] Failed after ${MAX_RETRIES} retries: ${lastError?.message}`)
  throw lastError || new Error('Failed after retries')
}

export function truncateForContext(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  return text.slice(0, maxChars) + '\n\n[Content truncated for model context window]'
}
