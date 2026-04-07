import { MotionConfig } from 'motion/react'
import { springs } from './springs'
import type { ReactNode } from 'react'

interface MotionProviderProps {
  children: ReactNode
}

export function MotionProvider({ children }: MotionProviderProps) {
  return (
    <MotionConfig
      transition={springs.snappy}
      reducedMotion="user"
    >
      {children}
    </MotionConfig>
  )
}
