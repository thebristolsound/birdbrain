import { springs } from './springs'
import { STAGGER_INTERVAL, OVERLAY_DURATION } from './constants'

function makePreset(
  initial: Record<string, unknown>,
  animate: Record<string, unknown>,
  transition: Record<string, unknown>,
  exit?: Record<string, unknown>
) {
  return {
    initial,
    animate,
    exit: exit ?? initial,
    transition
  }
}

export const presets = {
  fadeUp: makePreset(
    { opacity: 0, y: 8 },
    { opacity: 1, y: 0 },
    springs.snappy
  ),

  fadeIn: makePreset(
    { opacity: 0 },
    { opacity: 1 },
    springs.snappy
  ),

  scaleIn: makePreset(
    { opacity: 0, scale: 0.95 },
    { opacity: 1, scale: 1 },
    springs.snappy
  ),

  modal: makePreset(
    { opacity: 0, scale: 0.96, y: 12 },
    { opacity: 1, scale: 1, y: 0 },
    springs.gentle
  ),

  overlay: makePreset(
    { opacity: 0 },
    { opacity: 1 },
    { duration: OVERLAY_DURATION }
  ),

  slidePanel: makePreset(
    { opacity: 0, x: '100%' },
    { opacity: 1, x: 0 },
    springs.gentle,
    { opacity: 0, x: '100%' }
  ),

  listItem: makePreset(
    { opacity: 0, x: -8 },
    { opacity: 1, x: 0 },
    springs.snappy
  ),

  stagger: {
    initial: 'hidden',
    animate: {
      transition: {
        staggerChildren: STAGGER_INTERVAL
      }
    },
    exit: 'hidden'
  },

  popover: makePreset(
    { opacity: 0, scale: 0.97, y: -4 },
    { opacity: 1, scale: 1, y: 0 },
    springs.snappy
  ),

  collapse: makePreset(
    { opacity: 0, height: 0 },
    { opacity: 1, height: 'auto' },
    springs.snappy
  )
} as const
