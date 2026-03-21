import { Puzzle, Download, CheckCircle } from 'lucide-react'

interface ExtensionBannerProps {
  connected: boolean
}

export function ExtensionBanner({ connected }: ExtensionBannerProps) {
  return (
    <div
      className="anim-up d9 mt-8 neu-card rounded-2xl p-6 flex items-center justify-between"
      style={{ animationDelay: '1.1s' }}
    >
      {connected ? (
        <>
          <div className="flex items-center gap-5">
            <div className="w-12 h-12 rounded-2xl bg-emerald-950 border border-emerald-700/40 flex items-center justify-center flex-shrink-0 shadow-lg shadow-emerald-500/10">
              <CheckCircle className="h-6 w-6 text-emerald-300" />
            </div>
            <div>
              <h4 className="font-display font-bold text-sm text-slate-50 mb-0.5">
                Browser Extension Connected
              </h4>
              <p className="text-[11px] text-slate-500 leading-relaxed">
                Your extension is connected and ready to capture.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-2 px-4 py-2 bg-emerald-950 border border-emerald-700/40 text-emerald-300 font-display font-bold text-xs rounded-xl">
              <CheckCircle className="h-3.5 w-3.5" />
              Connected
            </span>
          </div>
        </>
      ) : (
        <>
          <div className="flex items-center gap-5">
            <div className="w-12 h-12 rounded-2xl bg-indigo-950 border border-indigo-700/40 flex items-center justify-center flex-shrink-0 shadow-lg shadow-indigo-500/10">
              <Puzzle className="h-6 w-6 text-indigo-300" />
            </div>
            <div>
              <h4 className="font-display font-bold text-sm text-slate-50 mb-0.5">
                Install the Browser Extension
              </h4>
              <p className="text-[11px] text-slate-500 leading-relaxed">
                Capture pages seamlessly while you browse. Works with Chrome, Edge, and Brave.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-display font-bold text-xs rounded-xl shadow-lg shadow-indigo-500/30 transition-all active:scale-[0.98]">
              <Download className="h-3.5 w-3.5" />
              Install Extension
            </button>
            <button className="text-[11px] font-bold text-indigo-400 hover:text-indigo-300 transition-colors">
              Learn More →
            </button>
          </div>
        </>
      )}
    </div>
  )
}
