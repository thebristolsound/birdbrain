import {
  Camera,
  Globe,
  FileText,
  Download,
  ToggleRight,
  Search,
  ArrowRight,
  Lightbulb
} from 'lucide-react'
import { motion } from 'motion/react'
import { useReduceMotion } from '@renderer/hooks/useReduceMotion'
import { Button } from '@renderer/components/ui'
import { openExtensionFolder } from '@renderer/lib/api/system'
import { startTour } from '@renderer/components/onboarding/startTour'

// Step 2 says what the toggle does and stops there. Session-driven capture is
// HOTFIX-disabled in the extension (extension/src/background.ts:686), so the
// only thing an active session still drives is selector matching; promising
// that pages are saved as you browse would tell the operator evidence exists
// when none does. Steps 1 and 3 and the hero line make that promise too and are
// left for the panel-wide copy pass.
// It also leads with the precondition rather than the instruction: SessionControls
// renders null until the extension connects (status/SessionControls.tsx), and this
// panel is only shown to an operator who has captured nothing yet, so "toggle it in
// the header bar" pointed at an empty header and read as a missing control (#468).
const STEPS = [
  {
    n: 1,
    icon: Download,
    title: 'Install the browser extension',
    body: 'Add the Birdbrain extension to Chrome (or another Chromium-based browser) to enable automatic web page capturing.'
  },
  {
    n: 2,
    icon: ToggleRight,
    title: 'Start a capture session',
    body: 'Once the extension connects, a Capture Session toggle appears in the header bar — switch it on. The extension then checks each page you visit against your case selectors and flags the matches.'
  },
  {
    n: 3,
    icon: Search,
    title: 'Browse and investigate',
    body: 'Visit web pages relevant to your case. Birdbrain saves screenshots, metadata, text, and source archives.'
  }
]

export function CapturesGettingStarted() {
  const reduce = useReduceMotion()

  const handleInstall = async () => {
    try {
      await openExtensionFolder()
    } catch (err) {
      console.error('Failed to open extension folder:', err)
    }
  }

  return (
    <main
      data-testid="captures-getting-started"
      className="flex flex-1 items-center justify-center overflow-y-auto bg-canvas p-8"
    >
      <div className="w-full max-w-lg">
        {/* Hero */}
        <div className="mb-10 text-center">
          <div className="relative mx-auto mb-6 inline-block">
            {!reduce && (
              <motion.div
                aria-hidden
                className="absolute h-28 w-28 rounded-full border-2 border-accent/20"
                style={{ left: '50%', top: '50%', x: '-50%', y: '-50%' }}
                animate={{ scale: [0.9, 1.05, 0.9], opacity: [0.6, 0.3, 0.6] }}
                transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
              />
            )}
            <div className="relative z-10 mx-auto flex h-24 w-24 items-center justify-center rounded-3xl bg-accent-subtle shadow-card">
              <motion.div
                animate={reduce ? undefined : { y: [0, -8, 0] }}
                transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
              >
                <Camera className="h-10 w-10 text-accent" />
              </motion.div>
            </div>
            <motion.div
              className="absolute -right-4 -top-2 flex h-8 w-8 items-center justify-center rounded-lg border border-emerald-500/20 bg-emerald-500/10"
              animate={reduce ? undefined : { y: [0, -8, 0] }}
              transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut', delay: 0.5 }}
            >
              <Globe className="h-4 w-4 text-emerald-400" />
            </motion.div>
            <motion.div
              className="absolute -bottom-1 -left-5 flex h-8 w-8 items-center justify-center rounded-lg border border-amber-500/20 bg-amber-500/10"
              animate={reduce ? undefined : { y: [0, -8, 0] }}
              transition={{ duration: 3.5, repeat: Infinity, ease: 'easeInOut', delay: 1 }}
            >
              <FileText className="h-4 w-4 text-amber-500" />
            </motion.div>
          </div>
          <h2 className="mb-2 text-xl font-semibold text-text-primary">Start capturing the web</h2>
          <p className="mx-auto max-w-sm text-sm leading-relaxed text-text-muted">
            Birdbrain saves pages to the current case as you browse. Get started in three steps.
          </p>
        </div>

        {/* Steps */}
        <div className="mb-8 space-y-3">
          {STEPS.map(({ n, icon: Icon, title, body }) => (
            <div
              key={n}
              className="flex items-start gap-4 rounded-xl border border-border bg-card p-4 transition-colors hover:border-border-strong"
            >
              <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-accent-subtle">
                <span className="text-sm font-bold text-accent">{n}</span>
              </div>
              <div className="flex-1">
                <h4 className="mb-0.5 text-sm font-semibold text-text-primary">{title}</h4>
                <p className="text-xs leading-relaxed text-text-muted">{body}</p>
              </div>
              <Icon className="mt-0.5 h-4 w-4 flex-shrink-0 text-text-faint" />
            </div>
          ))}
        </div>

        {/* CTA */}
        <div className="flex items-center justify-center gap-3">
          <Button
            data-testid="captures-getting-started-install-btn"
            onClick={handleInstall}
            className="gap-2"
          >
            <Download className="h-4 w-4" />
            Install Extension
          </Button>
          <button
            data-testid="captures-getting-started-learn-more-btn"
            onClick={() => startTour('ext')}
            className="flex items-center gap-1.5 rounded-lg border border-transparent px-4 py-2.5 text-sm font-medium text-text-muted transition-colors hover:border-border hover:bg-card hover:text-text-secondary"
          >
            Learn more
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>

        {/* Pro tip */}
        <div className="mt-8 flex items-start gap-2.5 rounded-lg border border-amber-500/20 bg-amber-500/10 p-3.5">
          <Lightbulb className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-500" />
          <p className="text-xs leading-relaxed text-amber-600">
            <span className="font-semibold">Pro tip:</span> You can also manually capture any page
            by clicking the Birdbrain icon in your browser toolbar and selecting "Capture This
            Page".
          </p>
        </div>
      </div>
    </main>
  )
}
