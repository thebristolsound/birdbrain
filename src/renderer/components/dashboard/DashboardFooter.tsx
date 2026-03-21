import { Radar, Github } from 'lucide-react'
import { useAppVersion } from '@renderer/hooks/useAppVersion'

export function DashboardFooter() {
  const appVersion = useAppVersion()

  return (
    <footer className="anim-in border-t border-white/[0.06] px-8 py-6" style={{ animationDelay: '1.2s' }}>
      <div className="max-w-5xl mx-auto flex items-center justify-between">
        {/* Left: logo + version text */}
        <div className="flex items-center gap-2">
          <div className="flex h-5 w-5 items-center justify-center rounded bg-indigo-600 shadow-sm shadow-indigo-500/30">
            <Radar className="h-2.5 w-2.5 text-white" />
          </div>
          <span className="text-[11px] text-slate-600">
            {`Birdbrain v${appVersion} — Open-Source Intelligence Platform`}
          </span>
        </div>

        {/* Right: links */}
        <div className="flex items-center gap-6">
          <span className="text-[11px] font-medium text-slate-600 opacity-60 cursor-default">
            Documentation
          </span>
          <span className="text-[11px] font-medium text-slate-600 opacity-60 cursor-default">
            Changelog
          </span>
          <span className="flex items-center gap-1 text-[11px] font-medium text-slate-600 opacity-60 cursor-default">
            <Github className="h-3.5 w-3.5" />
            GitHub
          </span>
        </div>
      </div>
    </footer>
  )
}
