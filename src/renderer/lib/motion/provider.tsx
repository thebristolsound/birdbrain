import { MotionConfig } from 'motion/react'
import { springs } from './springs'
import { useReduceMotion } from '@renderer/hooks/useReduceMotion'
import type { ReactNode } from 'react'

interface MotionProviderProps {
  children: ReactNode
}

export function MotionProvider({ children }: MotionProviderProps) {
  const reduce = useReduceMotion()
  return (
    <MotionConfig transition={springs.snappy} reducedMotion={reduce ? 'always' : 'user'}>
      {children}
    </MotionConfig>
  )
}
