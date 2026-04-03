import { useTheme } from '@renderer/hooks/useTheme'

export function AppearanceConfig() {
  const { theme, toggleTheme } = useTheme()

  return (
    <section className="neu-card rounded-2xl p-5">
      <h2 className="mb-4 text-lg font-semibold text-text-primary">Appearance</h2>
      <div className="space-y-4">
        <div>
          <label className="mb-2 block text-sm text-text-muted">Theme</label>
          <div className="flex gap-3">
            <button
              onClick={() => theme !== 'light' && toggleTheme()}
              className={`flex-1 rounded-xl border-2 p-3 text-center text-sm font-medium transition-colors ${
                theme === 'light'
                  ? 'border-accent bg-accent-subtle text-accent'
                  : 'border-border-strong bg-card text-text-muted hover:border-accent/30'
              }`}
            >
              Light
            </button>
            <button
              onClick={() => theme !== 'dark' && toggleTheme()}
              className={`flex-1 rounded-xl border-2 p-3 text-center text-sm font-medium transition-colors ${
                theme === 'dark'
                  ? 'border-accent bg-accent-subtle text-accent'
                  : 'border-border-strong bg-card text-text-muted hover:border-accent/30'
              }`}
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
            aria-checked={false}
            disabled
            className="relative inline-flex h-5 w-9 items-center rounded-full bg-text-faint opacity-50"
          >
            <span className="inline-block h-3.5 w-3.5 translate-x-0.5 rounded-full bg-white" />
          </button>
        </div>
      </div>
    </section>
  )
}
