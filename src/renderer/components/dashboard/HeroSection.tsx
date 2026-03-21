import { Radar, PlusCircle, FolderOpen } from 'lucide-react'

interface HeroSectionProps {
  onNewInvestigation: () => void
  onOpenRecent: () => void
}

export function HeroSection({ onNewInvestigation, onOpenRecent }: HeroSectionProps) {
  return (
    <section className="relative pt-16 pb-12 px-8">
      <div className="max-w-3xl mx-auto text-center">
        <div className="anim-scale d1 flex justify-center mb-8">
          <div className="logo-pulse w-16 h-16 rounded-2xl bg-indigo-600 flex items-center justify-center">
            <Radar className="h-8 w-8 text-white" />
          </div>
        </div>

        <h1 className="anim-up d2 font-display font-extrabold text-4xl tracking-tight text-slate-50 mb-3">
          Welcome to <span className="shimmer-text">Birdbrain</span>
        </h1>

        <p className="anim-up d3 text-base text-slate-400 max-w-lg mx-auto leading-relaxed mb-10">
          Your comprehensive open-source intelligence platform. Capture, extract, and analyze web
          intelligence with precision.
        </p>

        <div className="anim-up d4 flex items-center justify-center gap-4 mb-6">
          <button
            onClick={onNewInvestigation}
            className="group flex items-center gap-3 px-7 py-4 bg-indigo-600 hover:bg-indigo-500 text-white font-display font-bold text-sm rounded-2xl shadow-lg shadow-indigo-500/40 hover:shadow-xl hover:shadow-indigo-500/50 transition-all active:scale-[0.98]"
          >
            <PlusCircle className="h-5 w-5 group-hover:rotate-90 transition-transform duration-300" />
            Start New Investigation
          </button>
          <button
            onClick={onOpenRecent}
            className="flex items-center gap-3 px-6 py-4 border border-slate-700 hover:border-indigo-700 hover:bg-indigo-950/50 text-slate-100 font-display font-semibold text-sm rounded-2xl transition-all active:scale-[0.98]"
          >
            <FolderOpen className="h-5 w-5 text-indigo-400" />
            Open Recent Case
          </button>
        </div>

        <p className="anim-in d5 text-[11px] text-slate-600">
          <kbd className="px-1.5 py-0.5 rounded border border-slate-700 bg-slate-900 font-mono text-[10px] font-medium text-slate-400">Ctrl</kbd>
          {' + '}
          <kbd className="px-1.5 py-0.5 rounded border border-slate-700 bg-slate-900 font-mono text-[10px] font-medium text-slate-400">N</kbd>
          <span className="ml-1.5">to create · </span>
          <kbd className="px-1.5 py-0.5 rounded border border-slate-700 bg-slate-900 font-mono text-[10px] font-medium text-slate-400">Ctrl</kbd>
          {' + '}
          <kbd className="px-1.5 py-0.5 rounded border border-slate-700 bg-slate-900 font-mono text-[10px] font-medium text-slate-400">K</kbd>
          <span className="ml-1.5">to search</span>
        </p>
      </div>
    </section>
  )
}
