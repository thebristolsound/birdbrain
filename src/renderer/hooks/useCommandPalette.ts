import { useEffect } from 'react'
import { useAppStore } from '@renderer/stores/appStore'

export function useCommandPalette() {
  const open = useAppStore((s) => s.commandPaletteOpen)
  const setOpen = useAppStore((s) => s.setCommandPaletteOpen)
  const toggle = useAppStore((s) => s.toggleCommandPalette)

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.repeat) return
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault()
        toggle()
        return
      }
      if (e.key === 'Escape' && useAppStore.getState().commandPaletteOpen) {
        e.preventDefault()
        setOpen(false)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [setOpen, toggle])

  return { open, setOpen }
}
