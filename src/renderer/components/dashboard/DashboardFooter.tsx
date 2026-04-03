import { Radar, Github } from 'lucide-react'

export function DashboardFooter() {
  return (
    <footer
      className="anim-in border-t border-border px-8 py-6"
      style={{ animationDelay: '1.2s' }}
    >
      <div className="max-w-5xl mx-auto flex items-center justify-between">
        {/* Left: logo + version text */}
        <div className="flex items-center gap-2">
          <div className="flex h-5 w-5 items-center justify-center rounded bg-accent shadow-sm shadow-indigo-500/30">
            <Radar className="h-2.5 w-2.5 text-white" />
          </div>
          <span className="text-[11px] text-text-faint">
            Birdbrain v2.0.0 — Open-Source Intelligence Platform
          </span>
        </div>

        {/* Right: links */}
        <div className="flex items-center gap-6">
          <button className="text-[11px] font-medium text-text-faint hover:text-accent transition-colors">
            Documentation
          </button>
          <button className="text-[11px] font-medium text-text-faint hover:text-accent transition-colors">
            Changelog
          </button>
          <button className="flex items-center gap-1 text-[11px] font-medium text-text-faint hover:text-accent transition-colors">
            <Github className="h-3.5 w-3.5" />
            GitHub
          </button>
        </div>
      </div>
    </footer>
  )
}
