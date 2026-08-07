// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { BirdbrainSettings } from '@shared/types'

// Hoisted: the factory runs while AIConfig's import graph is still loading,
// which is before a plain top-level const would be initialised.
const notifyError = vi.hoisted(() => vi.fn())

vi.mock('@renderer/lib/notify', () => ({
  notify: { error: notifyError, warn: vi.fn(), success: vi.fn(), info: vi.fn() }
}))

import { AIConfig } from '@renderer/components/settings/AIConfig'
import { fakeBridge } from '../renderer/fakeBridge'

// Asserted, not annotated: AIConfig reads three of the ~20 fields on
// BirdbrainSettings, and spelling out the other seventeen here would be noise
// that says nothing about the behaviour under test.
const settings = {
  openRouterApiKey: 'sk-test',
  defaultModel: 'model-a',
  analysisSystemPrompt: 'prompt'
} as BirdbrainSettings

function renderConfig() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
  return render(<AIConfig settings={settings} onUpdate={vi.fn(async () => {})} />, {
    wrapper: Wrapper
  })
}

afterEach(() => {
  cleanup()
  notifyError.mockReset()
})

describe('AIConfig', () => {
  let openExternal: ReturnType<typeof vi.fn>
  // Held so the assertion can be on identity: the handler must pass the
  // original rejection through as `cause`, not a rewrapped stand-in.
  let cause: Error

  beforeEach(() => {
    cause = new Error('EACCES')
    openExternal = vi.fn(async () => {
      throw cause
    })
    fakeBridge({
      settings: { listModels: vi.fn(async () => []) },
      captures: { openExternal }
    })
  })

  it('reports a failed shell launch when the API-key link cannot be opened', async () => {
    renderConfig()

    fireEvent.click(screen.getByText('openrouter.ai/keys'))

    await waitFor(() => expect(notifyError).toHaveBeenCalledOnce())
    expect(openExternal).toHaveBeenCalledWith('https://openrouter.ai/keys')
    const [message, opts] = notifyError.mock.calls[0]
    // Exact match, not a substring: the message is a fixed literal with the URL
    // interpolated nowhere into it, which is what keeps URLs out of the durable
    // log. A message that grew a URL would fail here.
    expect(message).toBe("Couldn't open the link in your browser")
    expect(opts.cause).toBe(cause)
  })

  it('says nothing when the link opens successfully', async () => {
    openExternal.mockResolvedValue(undefined)
    renderConfig()

    fireEvent.click(screen.getByText('openrouter.ai/keys'))

    await waitFor(() => expect(openExternal).toHaveBeenCalledOnce())
    expect(notifyError).not.toHaveBeenCalled()
  })
})
