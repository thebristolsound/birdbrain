import { useEffect } from 'react'
import type { AnnotationTool } from './useAnnotationEditor'

interface Bindings {
  enabled: boolean
  setTool: (t: AnnotationTool) => void
  deselect: () => void
  removeSelected: () => void
  undo: () => void
  redo: () => void
}

const TOOL_KEYS: Record<string, AnnotationTool> = {
  v: 'select',
  r: 'rect',
  a: 'arrow',
  h: 'highlight',
  x: 'redact',
  p: 'pin'
}

export function useAnnotationKeyboardShortcuts(b: Bindings): void {
  useEffect(() => {
    if (!b.enabled) return

    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target) {
        const tag = target.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) return
      }

      if (e.key === 'Escape') {
        b.deselect()
        return
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        b.removeSelected()
        e.preventDefault()
        return
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
        if (e.shiftKey) b.redo()
        else b.undo()
        e.preventDefault()
        return
      }
      const lower = e.key.toLowerCase()
      const tool = TOOL_KEYS[lower]
      if (tool && !e.ctrlKey && !e.metaKey && !e.altKey) {
        b.setTool(tool)
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [b])
}
