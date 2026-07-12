import { useEffect, useState } from 'react'
import { useTheme } from '@renderer/hooks/useTheme'
import { useSettingsMutations } from '@renderer/lib/api/settings'
import { REDUCE_MOTION_STORAGE_KEY as STORAGE_KEY } from '@renderer/hooks/useReduceMotion'
import { Card, CardContent, Label } from '@renderer/components/ui'
import { cn } from '@renderer/lib/utils'

function readInitial(): boolean {
  return localStorage.getItem(STORAGE_KEY) === 'true'
}

function applyReduceMotionClass(enabled: boolean): void {
  document.documentElement.classList.toggle('reduce-motion', enabled)
}

export function AppearanceConfig() {
  const { theme, toggleTheme } = useTheme()
  const { update: updateSettings } = useSettingsMutations()
  const [reduce, setReduce] = useState<boolean>(readInitial)

  useEffect(() => {
    applyReduceMotionClass(reduce)
  }, [reduce])

  function handleToggle() {
    const next = !reduce
    setReduce(next)
    localStorage.setItem(STORAGE_KEY, String(next))
    window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEY, newValue: String(next) }))
    updateSettings.mutate({ reduceMotion: next })
  }

  return (
    <Card>
      <CardContent>
        <h2 className="mb-4 text-lg font-semibold text-text-primary">Appearance</h2>
        <div className="space-y-4">
          <div>
            <Label className="mb-2">Theme</Label>
            <div className="flex gap-3">
              <button
                onClick={() => theme !== 'light' && toggleTheme()}
                className={cn(
                  'flex-1 rounded-xl border-2 p-3 text-center text-sm font-medium transition-colors',
                  theme === 'light'
                    ? 'border-accent bg-accent-subtle text-accent'
                    : 'border-border-strong bg-card text-text-muted hover:border-accent/30'
                )}
              >
                Light
              </button>
              <button
                onClick={() => theme !== 'dark' && toggleTheme()}
                className={cn(
                  'flex-1 rounded-xl border-2 p-3 text-center text-sm font-medium transition-colors',
                  theme === 'dark'
                    ? 'border-accent bg-accent-subtle text-accent'
                    : 'border-border-strong bg-card text-text-muted hover:border-accent/30'
                )}
              >
                Dark
              </button>
            </div>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-text-primary">Reduce motion</div>
              <div className="text-xs text-text-muted">Disable animations throughout the app</div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={reduce}
              onClick={handleToggle}
              className={cn(
                'relative inline-flex h-5 w-9 items-center rounded-full transition-colors',
                reduce ? 'bg-accent' : 'bg-text-faint'
              )}
            >
              <span
                className={cn(
                  'inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform',
                  reduce ? 'translate-x-[18px]' : 'translate-x-0.5'
                )}
              />
            </button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
