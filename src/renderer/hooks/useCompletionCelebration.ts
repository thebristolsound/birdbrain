import { useState, useCallback, useRef, useEffect } from 'react'
import type { TargetAndTransition, Transition } from 'motion/react'
import { springs } from '@renderer/lib/motion'
import { CELEBRATION_HOLD_MS } from '@renderer/lib/motion'

type CelebrationStyle = 'checkmark' | 'pulse' | 'ripple'

interface CompletionCelebrationOptions {
  style?: CelebrationStyle
  holdDuration?: number
}

interface CelebrationProps {
  animate?: TargetAndTransition
  transition?: Transition
}

export function useCompletionCelebration(options: CompletionCelebrationOptions = {}) {
  const { style = 'pulse', holdDuration = CELEBRATION_HOLD_MS } = options
  const [celebrating, setCelebrating] = useState(false)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const celebrate = useCallback(() => {
    setCelebrating(true)
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    timeoutRef.current = setTimeout(() => setCelebrating(false), holdDuration)
  }, [holdDuration])

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
    }
  }, [])

  const celebrationProps: CelebrationProps = celebrating ? getCelebrationAnimation(style) : {}

  return { celebrate, celebrating, celebrationProps }
}

function getCelebrationAnimation(style: CelebrationStyle): CelebrationProps {
  switch (style) {
    case 'checkmark':
      return {
        animate: { scale: [1, 1.05, 1], opacity: [0.8, 1, 1] },
        transition: { duration: 0.4, ease: 'easeOut' }
      }
    case 'pulse':
      return {
        animate: { scale: [1, 1.08, 1] },
        transition: springs.bouncy
      }
    case 'ripple':
      return {
        animate: { scale: [1, 1.03, 1], opacity: [1, 0.9, 1] },
        transition: { duration: 0.5, ease: 'easeOut' }
      }
  }
}
