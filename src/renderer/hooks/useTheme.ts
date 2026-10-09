import { useState, useCallback, useEffect } from 'react'
import type { QueryClient } from '@tanstack/react-query'
import { useSettingsMutations } from '@renderer/lib/queries'
import { settingsQueryOptions } from '@renderer/lib/api/settings'
import { queryKeys } from '@renderer/lib/api/keys'

type Theme = 'light' | 'dark'

// The handoff is authored dark-first, so a first run opens dark. theme-init.js
// applies the same default before first paint and cannot import this.
export const DEFAULT_THEME: Theme = 'dark'

// The class holds a forced colour transition for as long as the swap takes, so
// the switch cross-fades instead of cutting.
export const THEME_FADE_CLASS = 'theme-fading'
export const THEME_FADE_MS = 240

let fadeTimer: ReturnType<typeof setTimeout> | undefined

function getInitialTheme(): Theme {
  const stored = localStorage.getItem('theme')
  if (stored === 'dark' || stored === 'light') return stored
  return DEFAULT_THEME
}

function applyTheme(theme: Theme): void {
  if (theme === 'dark') {
    document.documentElement.classList.add('dark')
  } else {
    document.documentElement.classList.remove('dark')
  }
}

// The page takes its theme from localStorage (theme-init.js), the native window controls
// from settings.json (src/main/windowChrome.ts). A toggle writes both, so a settings write
// that never landed leaves them apart until the next toggle. The page is what the operator
// sees, so its theme is written back once at startup; main recolours the controls on it.
export async function reconcilePersistedTheme(queryClient: QueryClient): Promise<void> {
  const theme = getInitialTheme()
  const persisted = await queryClient.fetchQuery(settingsQueryOptions)
  if (persisted.theme === theme) return
  queryClient.setQueryData(queryKeys.settings, await window.birdbrain.settings.update({ theme }))
}

function prefersReducedMotion(): boolean {
  if (document.documentElement.classList.contains('reduce-motion')) return true
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function startThemeFade(): void {
  if (prefersReducedMotion()) return
  const root = document.documentElement
  root.classList.add(THEME_FADE_CLASS)
  clearTimeout(fadeTimer)
  fadeTimer = setTimeout(() => root.classList.remove(THEME_FADE_CLASS), THEME_FADE_MS)
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(getInitialTheme)
  const { update } = useSettingsMutations()

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  const toggleTheme = useCallback(() => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark'

    startThemeFade()
    applyTheme(next)
    setTheme(next)
    localStorage.setItem('theme', next)
    update.mutate({ theme: next })
  }, [theme])

  return { theme, toggleTheme } as const
}
