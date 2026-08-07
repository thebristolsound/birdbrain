import { useState, useCallback, useEffect } from 'react'
import { useSettingsMutations } from '@renderer/lib/queries'

type Theme = 'light' | 'dark'

function getInitialTheme(): Theme {
  const stored = localStorage.getItem('theme')
  if (stored === 'dark' || stored === 'light') return stored
  return 'light'
}

function applyTheme(theme: Theme): void {
  if (theme === 'dark') {
    document.documentElement.classList.add('dark')
  } else {
    document.documentElement.classList.remove('dark')
  }
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(getInitialTheme)
  const { update } = useSettingsMutations()

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  const toggleTheme = useCallback(() => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark'

    document.documentElement.classList.add('no-transitions')
    applyTheme(next)
    setTheme(next)
    localStorage.setItem('theme', next)
    update.mutate({ theme: next })

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        document.documentElement.classList.remove('no-transitions')
      })
    })
  }, [theme])

  return { theme, toggleTheme } as const
}
