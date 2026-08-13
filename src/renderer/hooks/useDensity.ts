import { useState, useCallback, useEffect } from 'react'
import { DEFAULT_UI_DENSITY, UI_DENSITIES, type UiDensity } from '@shared/types'
import { useSettingsMutations } from '@renderer/lib/api/settings'

export const DENSITY_STORAGE_KEY = 'density'

function isDensity(value: unknown): value is UiDensity {
  return UI_DENSITIES.includes(value as UiDensity)
}

// localStorage is the pre-paint source of truth (theme-init.js reads the same
// key before React mounts), mirroring how theme and reduceMotion work; the
// settings file carries the validated copy.
export function readStoredDensity(): UiDensity {
  const stored = localStorage.getItem(DENSITY_STORAGE_KEY)
  return isDensity(stored) ? stored : DEFAULT_UI_DENSITY
}

export function applyDensity(density: UiDensity): void {
  document.documentElement.dataset.density = density
}

export function useDensity() {
  const [density, setDensityState] = useState<UiDensity>(readStoredDensity)
  const { update } = useSettingsMutations()

  useEffect(() => {
    applyDensity(density)
  }, [density])

  const setDensity = useCallback(
    (next: UiDensity) => {
      if (next === density) return
      applyDensity(next)
      setDensityState(next)
      localStorage.setItem(DENSITY_STORAGE_KEY, next)
      update.mutate({ density: next })
    },
    [density, update]
  )

  return { density, setDensity } as const
}
