// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createElement, type ReactNode } from 'react'
import { renderHook, act, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  useTheme,
  followStoredTheme,
  reconcilePersistedTheme,
  THEME_FADE_CLASS,
  THEME_FADE_MS
} from '@renderer/hooks/useTheme'
import { queryKeys } from '@renderer/lib/api/keys'
import { fakeBridge } from '../renderer/fakeBridge'
import { stubMatchMedia } from '../components/matchMediaStub'

const root = document.documentElement

function renderTheme() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client }, children)
  }
  return renderHook(() => useTheme(), { wrapper: Wrapper })
}

describe('useTheme', () => {
  let update: ReturnType<typeof vi.fn>

  beforeEach(() => {
    localStorage.clear()
    root.className = ''
    update = vi.fn(async () => ({}))
    fakeBridge({ settings: { update } })
    stubMatchMedia(false)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('opens dark when no theme has been chosen', () => {
    const { result } = renderTheme()
    expect(result.current.theme).toBe('dark')
    expect(root.classList.contains('dark')).toBe(true)
  })

  it('keeps an explicit light choice', () => {
    localStorage.setItem('theme', 'light')
    const { result } = renderTheme()
    expect(result.current.theme).toBe('light')
    expect(root.classList.contains('dark')).toBe(false)
  })

  it('cross-fades the switch and persists the new theme', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const { result } = renderTheme()

    act(() => result.current.toggleTheme())

    expect(root.classList.contains(THEME_FADE_CLASS)).toBe(true)
    expect(root.classList.contains('dark')).toBe(false)
    expect(result.current.theme).toBe('light')
    expect(localStorage.getItem('theme')).toBe('light')

    act(() => {
      vi.advanceTimersByTime(THEME_FADE_MS)
    })
    expect(root.classList.contains(THEME_FADE_CLASS)).toBe(false)

    vi.useRealTimers()
    await waitFor(() => expect(update).toHaveBeenCalledWith({ theme: 'light' }))
  })

  it('restarts the fade window when switched again mid-fade', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const { result } = renderTheme()

    act(() => result.current.toggleTheme())
    act(() => {
      vi.advanceTimersByTime(THEME_FADE_MS - 40)
    })
    act(() => result.current.toggleTheme())
    act(() => {
      vi.advanceTimersByTime(THEME_FADE_MS - 40)
    })
    expect(root.classList.contains(THEME_FADE_CLASS)).toBe(true)

    act(() => {
      vi.advanceTimersByTime(40)
    })
    expect(root.classList.contains(THEME_FADE_CLASS)).toBe(false)
  })

  it('cuts instantly under the in-app reduce-motion setting', () => {
    root.classList.add('reduce-motion')
    const { result } = renderTheme()

    act(() => result.current.toggleTheme())

    expect(root.classList.contains(THEME_FADE_CLASS)).toBe(false)
    expect(root.classList.contains('dark')).toBe(false)
  })

  it('cuts instantly when the system asks for reduced motion', () => {
    stubMatchMedia(true)
    const { result } = renderTheme()

    act(() => result.current.toggleTheme())

    expect(root.classList.contains(THEME_FADE_CLASS)).toBe(false)
  })
})

describe('reconcilePersistedTheme', () => {
  let client: QueryClient
  let get: ReturnType<typeof vi.fn>
  let update: ReturnType<typeof vi.fn>

  function persist(theme: 'dark' | 'light') {
    get = vi.fn(async () => ({ theme }))
    update = vi.fn(async (partial: { theme: 'dark' | 'light' }) => ({ theme: partial.theme }))
    fakeBridge({ settings: { get, update } })
  }

  beforeEach(() => {
    localStorage.clear()
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  })

  it('writes the page theme back when settings.json holds the other one', async () => {
    // The window opened its controls light from settings.json; the page painted dark.
    persist('light')
    await reconcilePersistedTheme(client)
    expect(update).toHaveBeenCalledWith({ theme: 'dark' })
    expect(client.getQueryData(queryKeys.settings)).toEqual({ theme: 'dark' })
  })

  it('writes nothing when the two already agree', async () => {
    localStorage.setItem('theme', 'light')
    persist('light')
    await reconcilePersistedTheme(client)
    expect(get).toHaveBeenCalledOnce()
    expect(update).not.toHaveBeenCalled()
  })
})

describe('theme-init.js', () => {
  const script = readFileSync(resolve(__dirname, '../../src/renderer/public/theme-init.js'), 'utf8')

  beforeEach(() => {
    localStorage.clear()
    root.className = ''
  })

  it('paints dark before first render when no theme has been chosen', () => {
    new Function(script)()
    expect(root.classList.contains('dark')).toBe(true)
  })

  it('paints light only for an explicit light choice', () => {
    localStorage.setItem('theme', 'light')
    new Function(script)()
    expect(root.classList.contains('dark')).toBe(false)
  })
})

// The Capture Session pop-out is a second page on the same origin, so it shares the main window's
// localStorage and hears the main window's toggle as a storage event.
describe('followStoredTheme', () => {
  function stored(key: string, newValue: string | null) {
    window.dispatchEvent(new StorageEvent('storage', { key, newValue }))
  }

  beforeEach(() => {
    root.className = 'dark'
  })

  it('takes the theme another window stores', () => {
    const stop = followStoredTheme()
    stored('theme', 'light')
    expect(root.classList.contains('dark')).toBe(false)
    stored('theme', 'dark')
    expect(root.classList.contains('dark')).toBe(true)
    stop()
  })

  it('reads a cleared theme as the first-run theme and ignores other keys', () => {
    const stop = followStoredTheme()
    stored('theme', 'light')
    stored('density', 'dark')
    expect(root.classList.contains('dark')).toBe(false)
    stored('theme', null)
    expect(root.classList.contains('dark')).toBe(true)
    stop()
  })

  it('stops following once stopped', () => {
    followStoredTheme()()
    stored('theme', 'light')
    expect(root.classList.contains('dark')).toBe(true)
  })
})
