import { describe, it, expect, vi, beforeEach } from 'vitest'
import { testApiKey, listModels } from '@main/services/openrouter'

describe('openrouter', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('testApiKey returns true for valid key', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{}', { status: 200 })
    )
    const result = await testApiKey('sk-valid-key')
    expect(result).toBe(true)
  })

  it('testApiKey returns false for invalid key', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('Unauthorized', { status: 401 })
    )
    const result = await testApiKey('sk-bad-key')
    expect(result).toBe(false)
  })

  it('testApiKey returns false on network error', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network error'))
    const result = await testApiKey('sk-any')
    expect(result).toBe(false)
  })

  it('listModels parses model data', async () => {
    const mockData = {
      data: [
        {
          id: 'anthropic/claude-sonnet-4',
          name: 'Claude Sonnet 4',
          context_length: 200000,
          pricing: { prompt: '0.003', completion: '0.015' }
        },
        {
          id: 'openai/gpt-4o',
          name: 'GPT-4o',
          context_length: 128000,
          pricing: { prompt: '0.005', completion: '0.015' }
        }
      ]
    }
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(mockData), { status: 200 })
    )

    const models = await listModels('sk-valid')
    expect(models).toHaveLength(2)
    expect(models[0].id).toBe('anthropic/claude-sonnet-4')
    expect(models[0].contextLength).toBe(200000)
    expect(models[1].name).toBe('GPT-4o')
  })

  it('listModels throws on API error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('Server Error', { status: 500 })
    )
    await expect(listModels('sk-valid')).rejects.toThrow('OpenRouter API error: 500')
  })
})
