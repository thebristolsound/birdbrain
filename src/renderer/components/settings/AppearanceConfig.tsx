export function AppearanceConfig() {
  return (
    <section className="neu-card rounded-2xl p-5">
      <h2 className="mb-4 text-lg font-semibold text-slate-200">Appearance</h2>
      <div className="space-y-4">
        <div>
          <label className="mb-2 block text-sm text-slate-400">Theme</label>
          <div className="flex gap-3">
            <button className="flex-1 rounded-xl border-2 border-indigo-500 bg-indigo-500/10 p-3 text-center text-sm font-medium text-indigo-300">
              Dark
            </button>
            <button
              className="flex-1 rounded-xl border border-white/[0.08] bg-slate-800 p-3 text-center text-sm text-slate-400 hover:border-white/[0.15]"
              disabled
            >
              Light (coming soon)
            </button>
            <button
              className="flex-1 rounded-xl border border-white/[0.08] bg-slate-800 p-3 text-center text-sm text-slate-400 hover:border-white/[0.15]"
              disabled
            >
              System (coming soon)
            </button>
          </div>
        </div>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm text-slate-200">Reduce motion</div>
            <div className="text-xs text-slate-500">Disable animations throughout the app</div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={false}
            disabled
            className="relative inline-flex h-5 w-9 items-center rounded-full bg-slate-600 opacity-50"
          >
            <span className="inline-block h-3.5 w-3.5 translate-x-0.5 rounded-full bg-white" />
          </button>
        </div>
      </div>
    </section>
  )
}
