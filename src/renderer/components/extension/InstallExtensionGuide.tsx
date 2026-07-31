import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { ArrowLeft, Pin } from 'lucide-react'
import { Card } from '@renderer/components/ui'
import logoImg from '@renderer/assets/logo.png'
import { INSTALL_STEPS } from '@renderer/components/extension/installSteps'

interface StepPanelProps {
  number: number
  title: string
  sub: ReactNode
  caption: ReactNode
  children: ReactNode
}

function StepPanel({ number, title, sub, caption, children }: StepPanelProps) {
  return (
    <Card className="flex flex-col gap-[18px] p-6">
      <div className="flex items-center gap-3">
        <div className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-[10px] border border-accent/20 bg-accent-subtle font-mono text-[13px] font-semibold text-accent">
          {number}
        </div>
        <div>
          <div className="font-display text-sm font-bold text-text-primary">{title}</div>
          <div className="text-[11px] text-text-muted">{sub}</div>
        </div>
      </div>
      <div
        aria-hidden
        className="flex flex-1 flex-col overflow-hidden rounded-xl border border-border-strong bg-surface"
      >
        {children}
      </div>
      <div className="text-xs leading-relaxed text-text-muted">{caption}</div>
    </Card>
  )
}

export function InstallExtensionGuide() {
  return (
    <div
      data-testid="install-extension-guide"
      className="grid-bg min-h-full px-8 pb-16 pt-8 lg:px-16"
    >
      <div className="mx-auto max-w-6xl">
        <Link
          to="/"
          data-testid="install-guide-back-link"
          className="mb-8 inline-flex items-center gap-1.5 text-xs font-medium text-text-muted transition-colors hover:text-text-primary"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Dashboard
        </Link>
        <div className="mb-2 flex items-center gap-3">
          <img src={logoImg} alt="Birdbrain" className="h-7 w-7" />
          <span className="font-display text-[13px] font-extrabold tracking-tight text-text-primary">
            Birdbrain
          </span>
          <span className="font-mono text-[11px] text-text-faint">/ setup guide</span>
        </div>
        <h1 className="mb-2.5 font-display text-4xl font-extrabold leading-[1.1] tracking-tight text-text-primary">
          Install a custom extension in Chrome
        </h1>
        <p className="mb-10 max-w-[640px] text-[15px] text-text-muted">
          Load an unpacked extension straight from a folder on your machine. No Web Store, no cloud
          — three steps.
        </p>

        <div className="grid grid-cols-1 items-stretch gap-6 lg:grid-cols-3">
          {INSTALL_STEPS.map((step, i) => (
            <StepPanel
              key={step.title}
              number={i + 1}
              title={step.title}
              sub={step.sub}
              caption={step.caption}
            >
              <step.Visual />
            </StepPanel>
          ))}
        </div>

        <div className="mt-7 flex items-center gap-2.5">
          <Pin className="h-3.5 w-3.5 flex-shrink-0 text-accent" />
          <span className="text-xs text-text-muted">
            Tip: click the puzzle-piece icon in the toolbar and pin the extension so it&apos;s
            always one click away. Edit code? Hit{' '}
            <kbd className="rounded border border-border-strong bg-surface px-1.5 py-0.5 font-mono text-[10px] font-medium text-text-muted">
              Reload
            </kbd>{' '}
            on the extension card.
          </span>
        </div>
      </div>
    </div>
  )
}
