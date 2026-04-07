import { useRef } from 'react'
import { springs } from '@renderer/lib/motion'
import { STAGGER_INTERVAL, STAGGER_CAP } from '@renderer/lib/motion'

interface UseStagedRevealOptions {
  items: unknown[]
  staggerInterval?: number
  preset?: 'listItem' | 'fadeUp' | 'scaleIn'
}

const presetVariants = {
  listItem: {
    hidden: { opacity: 0, x: -8 },
    visible: { opacity: 1, x: 0 }
  },
  fadeUp: {
    hidden: { opacity: 0, y: 8 },
    visible: { opacity: 1, y: 0 }
  },
  scaleIn: {
    hidden: { opacity: 0, scale: 0.95 },
    visible: { opacity: 1, scale: 1 }
  }
}

export function useStagedReveal({
  items,
  staggerInterval = STAGGER_INTERVAL,
  preset = 'listItem'
}: UseStagedRevealOptions) {
  const prevLengthRef = useRef(items.length)
  prevLengthRef.current = items.length

  const containerProps = {
    initial: 'hidden' as const,
    animate: 'visible' as const,
    variants: {
      hidden: {},
      visible: {
        transition: {
          staggerChildren: staggerInterval,
          // Cap stagger so long lists don't waterfall forever
          ...(items.length > STAGGER_CAP && {
            staggerChildren: staggerInterval * (STAGGER_CAP / items.length)
          })
        }
      }
    }
  }

  const itemProps = {
    variants: presetVariants[preset],
    transition: springs.snappy
  }

  return { containerProps, itemProps }
}
