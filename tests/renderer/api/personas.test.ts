// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement, type ReactNode } from 'react'
import { fakeBridge } from '../fakeBridge'
import { usePersonasMutations } from '@renderer/lib/api/personas'

afterEach(() => cleanup())

function renderMutations() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children)
  return renderHook(() => usePersonasMutations(), { wrapper })
}

describe('usePersonasMutations', () => {
  // The preload rejects a refused import with a plain object, because the
  // context bridge strips `.code` from an Error; the Personas row reads the
  // code off an Error.
  it('turns a refused cookie import into an Error that keeps the code', async () => {
    const importCookies = vi.fn().mockRejectedValue({
      message: 'Only a Netscape cookies.txt export can be imported.',
      code: 'PERSONA_COOKIE_FILE_UNSUPPORTED'
    })
    fakeBridge({ persona: { import: importCookies } })
    const { result } = renderMutations()

    const call = result.current.importCookies.mutateAsync('p-1')

    await expect(call).rejects.toBeInstanceOf(Error)
    expect(importCookies).toHaveBeenCalledWith('p-1')
    await expect(call).rejects.toMatchObject({
      message: 'Only a Netscape cookies.txt export can be imported.',
      code: 'PERSONA_COOKIE_FILE_UNSUPPORTED'
    })
  })
})
