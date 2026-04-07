import type { Transition } from 'motion/react'

type SpringConfig = Extract<Transition, { type: 'spring' }>

export const springs = {
  snappy: {
    type: 'spring',
    stiffness: 400,
    damping: 30
  },
  gentle: {
    type: 'spring',
    stiffness: 200,
    damping: 24
  },
  bouncy: {
    type: 'spring',
    stiffness: 500,
    damping: 15
  },
  molasses: {
    type: 'spring',
    stiffness: 120,
    damping: 20
  }
} as const satisfies Record<string, SpringConfig>
