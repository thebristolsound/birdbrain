import { useEffect, useRef } from 'react'
import type { AnnotationTool } from '@renderer/components/captures/annotation/useAnnotationEditor'

interface Bindings {
  enabled: boolean
  setTool: (t: AnnotationTool) => void
  getTool: () => AnnotationTool
  deselect: () => void
  removeSelected: () => void
  undo: () => void
  redo: () => void
  zoomIn: () => void
  zoomOut: () => void
  resetView: () => void
  oneToOne: () => void
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
  const ref = useRef(b)
  ref.current = b

  useEffect(() => {
    if (!b.enabled) return

    let toolBeforeSpace: AnnotationTool | null = null

    const isTypingTarget = (target: EventTarget | null) => {
      const el = target as HTMLElement | null
      if (!el) return false
      const tag = el.tagName
      return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return
      const c = ref.current

      if (e.key === 'Escape') {
        c.deselect()
        return
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        c.removeSelected()
        e.preventDefault()
        return
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
        if (e.shiftKey) c.redo()
        else c.undo()
        e.preventDefault()
        return
      }
      if (e.key === ' ' && !e.repeat) {
        if (toolBeforeSpace === null) {
          toolBeforeSpace = c.getTool()
          c.setTool('hand')
        }
        e.preventDefault()
        return
      }
      if (e.key === '+' || e.key === '=') {
        c.zoomIn()
        e.preventDefault()
        return
      }
      if (e.key === '-') {
        c.zoomOut()
        e.preventDefault()
        return
      }
      if (e.key === '0') {
        c.resetView()
        e.preventDefault()
        return
      }
      if (e.key === '1') {
        c.oneToOne()
        e.preventDefault()
        return
      }
      const lower = e.key.toLowerCase()
      const tool = TOOL_KEYS[lower]
      if (tool && !e.ctrlKey && !e.metaKey && !e.altKey) {
        c.setTool(tool)
      }
    }

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === ' ' && toolBeforeSpace !== null) {
        ref.current.setTool(toolBeforeSpace)
        toolBeforeSpace = null
        e.preventDefault()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [b.enabled])
}
