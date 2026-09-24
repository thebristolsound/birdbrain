import { Puzzle, FolderOpen, CheckCircle, BookOpen } from 'lucide-react'
import { Card, Button } from '@renderer/components/ui'
import { openExtensionFolder } from '@renderer/lib/api/system'
import { startTour } from '@renderer/components/onboarding/startTour'

interface ExtensionBannerProps {
  connected: boolean
}

export function ExtensionBanner({ connected }: ExtensionBannerProps) {
  const handleOpenFolder = async () => {
    try {
      await openExtensionFolder()
    } catch (err) {
      console.error('Failed to open extension folder:', err)
    }
  }

  // The mock's `browser` anchor rings a top-bar Browser button that opens a
  // simulated Chrome window. This app has neither, so the tour step rings the
  // banner it is actually describing — present in both connected states, and on
  // the dashboard route the step already declares. Sent back as #707.
  return (
    <Card data-tour="browser" className="mt-8 p-[var(--d-card)] flex items-center justify-between">
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
                Capture pages from Chrome, Edge, and Brave while the desktop app is running.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              data-testid="extension-banner-setup-guide"
              onClick={() => startTour('ext')}
              className="flex items-center gap-2 px-4 py-2.5 font-display font-medium text-xs rounded-xl border border-border-strong text-text-muted hover:bg-elevated hover:text-text-primary transition-colors"
            >
              <BookOpen className="h-3.5 w-3.5" />
              Setup Guide
            </button>
            <Button
              onClick={handleOpenFolder}
              className="gap-2 px-5 py-2.5 font-display font-bold text-xs rounded-xl shadow-lg shadow-indigo-500/30 active:scale-[0.98]"
            >
              <FolderOpen className="h-3.5 w-3.5" />
              Install Extension
            </Button>
          </div>
        </>
      )}
    </Card>
  )
}
