import { useState, useCallback, useEffect } from 'react'

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

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  const toggleTheme = useCallback(() => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark'

    document.documentElement.classList.add('transitioning')
    applyTheme(next)
    setTheme(next)
    localStorage.setItem('theme', next)
    window.birdbrain.settings.update({ theme: next })

    setTimeout(() => {
      document.documentElement.classList.remove('transitioning')
    }, 400)
  }, [theme])

  return { theme, toggleTheme } as const
}
