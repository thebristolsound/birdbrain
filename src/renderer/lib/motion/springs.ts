import type { Transition } from 'motion/react'

export const springs = {
  snappy: {
    type: 'spring' as const,
    stiffness: 400,
    damping: 30
  },
  gentle: {
    type: 'spring' as const,
    stiffness: 200,
    damping: 24
  },
  bouncy: {
    type: 'spring' as const,
    stiffness: 500,
    damping: 15
  },
  molasses: {
    type: 'spring' as const,
    stiffness: 120,
    damping: 20
  },
  microTap: {
    type: 'spring' as const,
    stiffness: 600,
    damping: 28
  },
  hover: {
    type: 'spring' as const,
    stiffness: 350,
    damping: 32
  }
} satisfies Record<string, Transition>
