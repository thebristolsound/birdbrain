import { Puzzle, FolderOpen, CheckCircle } from 'lucide-react'

interface ExtensionBannerProps {
  connected: boolean
}

export function ExtensionBanner({ connected }: ExtensionBannerProps) {
  const handleOpenFolder = async () => {
    try {
      await window.birdbrain.extension.openFolder()
    } catch (err) {
      console.error('Failed to open extension folder:', err)
    }
  }

  return (
    <div className="mt-8 neu-card rounded-2xl p-6 flex items-center justify-between">
      {connected ? (
        <>
          <div className="flex items-center gap-5">
            <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center flex-shrink-0 shadow-lg shadow-emerald-500/10">
              <CheckCircle className="h-6 w-6 text-emerald-500" />
            </div>
            <div>
              <h4 className="font-display font-bold text-sm text-text-primary mb-0.5">
                Browser Extension Connected
              </h4>
              <p className="text-[11px] text-text-muted leading-relaxed">
                Your extension is connected and ready to capture.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-2 px-4 py-2 bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 font-display font-bold text-xs rounded-xl">
              <CheckCircle className="h-3.5 w-3.5" />
              Connected
            </span>
          </div>
        </>
      ) : (
        <>
          <div className="flex items-center gap-5">
            <div className="w-12 h-12 rounded-2xl bg-accent-subtle border border-accent/20 flex items-center justify-center flex-shrink-0 shadow-lg shadow-indigo-500/10">
              <Puzzle className="h-6 w-6 text-accent" />
            </div>
            <div>
              <h4 className="font-display font-bold text-sm text-text-primary mb-0.5">
                Install the Browser Extension
              </h4>
              <p className="text-[11px] text-text-muted leading-relaxed">
                Capture pages seamlessly while you browse. Works with Chrome, Edge, and Brave.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handleOpenFolder}
              className="flex items-center gap-2 px-5 py-2.5 bg-accent hover:bg-accent-hover text-white font-display font-bold text-xs rounded-xl shadow-lg shadow-indigo-500/30 transition-all active:scale-[0.98]"
            >
              <FolderOpen className="h-3.5 w-3.5" />
              Install Extension
            </button>
          </div>
        </>
      )}
    </div>
  )
}
