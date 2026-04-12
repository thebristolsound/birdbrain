import { Radar, Github } from 'lucide-react'
import { Button } from '@renderer/components/ui'

export function DashboardFooter() {
  return (
    <footer className="border-t border-border px-8 py-6">
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
          <Button
            variant="link"
            size="xs"
            className="text-[11px] text-text-faint hover:text-accent no-underline"
          >
            Documentation
          </Button>
          <Button
            variant="link"
            size="xs"
            className="text-[11px] text-text-faint hover:text-accent no-underline"
          >
            Changelog
          </Button>
          <Button
            variant="link"
            size="xs"
            className="gap-1 text-[11px] text-text-faint hover:text-accent no-underline"
          >
            <Github className="h-3.5 w-3.5" />
            GitHub
          </Button>
        </div>
      </div>
    </footer>
  )
}
