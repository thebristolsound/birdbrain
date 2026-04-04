import type { OpenRouterModel } from '@shared/types'

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1'

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
