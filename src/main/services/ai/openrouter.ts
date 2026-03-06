import { getSettings } from '@main/services/settings'

interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

interface OpenRouterResponse {
  choices: Array<{
    message: { content: string }
  }>
  usage?: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
}

export interface PromptResult {
  content: string
  usage: { promptTokens: number; completionTokens: number; totalTokens: number }
}

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1'
const MAX_RETRIES = 3
const INITIAL_BACKOFF_MS = 1000

export async function sendPrompt(
  messages: ChatMessage[],
  model?: string,
  apiKey?: string
): Promise<PromptResult> {
  const settings = getSettings()
  const key = apiKey || settings.openRouterApiKey
  const modelId = model || settings.defaultModel

  if (!key) throw new Error('No OpenRouter API key configured')

  let lastError: Error | null = null

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
        body: JSON.stringify({
          model: modelId,
          messages
        })
      })

      if (res.status === 429) {
        const backoff = INITIAL_BACKOFF_MS * Math.pow(2, attempt)
        await new Promise((resolve) => setTimeout(resolve, backoff))
        continue
      }

      if (!res.ok) {
        throw new Error(`OpenRouter API error: ${res.status} ${res.statusText}`)
      }

      const data: OpenRouterResponse = await res.json()
      const content = data.choices?.[0]?.message?.content || ''

      return {
        content,
        usage: {
          promptTokens: data.usage?.prompt_tokens || 0,
          completionTokens: data.usage?.completion_tokens || 0,
          totalTokens: data.usage?.total_tokens || 0
        }
      }
    } catch (err) {
      lastError = err as Error
      if (attempt < MAX_RETRIES - 1) {
        const backoff = INITIAL_BACKOFF_MS * Math.pow(2, attempt)
        await new Promise((resolve) => setTimeout(resolve, backoff))
      }
    }
  }

  throw lastError || new Error('Failed after retries')
}

export function truncateForContext(text: string, maxChars: number = 100000): string {
  if (text.length <= maxChars) return text
  return text.slice(0, maxChars) + '\n\n[Content truncated for model context window]'
}
