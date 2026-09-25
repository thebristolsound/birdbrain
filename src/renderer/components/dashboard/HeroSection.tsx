import { PlusCircle, FolderOpen, Archive } from 'lucide-react'
import logoImg from '@renderer/assets/logo.png'
import { modifierLabel } from '@renderer/lib/accelerator'

interface HeroSectionProps {
  onNewInvestigation: () => void
  onOpenRecent: () => void
  onImportCase: () => void
}

export function HeroSection({ onNewInvestigation, onOpenRecent, onImportCase }: HeroSectionProps) {
  return (
    <section className="relative pt-16 pb-12 px-8">
      <div className="max-w-3xl mx-auto text-center">
        <div className="flex justify-center mb-8">
          <img src={logoImg} alt="Birdbrain" className="logo-pulse w-16 h-16" />
        </div>

        <h1 className="font-display font-extrabold text-4xl tracking-tight text-text-primary mb-3">
          Welcome to <span className="shimmer-text">Birdbrain</span>
        </h1>

        <p className="text-sm text-text-muted max-w-lg mx-auto leading-relaxed mb-10">
          Capture web pages, organize evidence by case, and verify what changed over time.
        </p>

        <div className="flex items-center justify-center gap-4 mb-6">
          <button
            data-testid="new-case-btn"
            data-tour="newcase"
            onClick={onNewInvestigation}
            className="group flex items-center gap-2 px-5 py-3 bg-accent hover:bg-accent-hover text-white font-display font-bold text-sm rounded-2xl transition-[transform,background-color] active:scale-[0.98]"
          >
            <PlusCircle className="h-4 w-4 group-hover:rotate-90 transition-transform duration-300" />
            Start New Investigation
          </button>
          <button
            onClick={onOpenRecent}
            className="flex items-center gap-2 px-5 py-3 border border-border-strong hover:border-accent hover:bg-accent-subtle text-text-primary font-display font-semibold text-sm rounded-2xl transition-[transform,border-color,background-color] active:scale-[0.98]"
          >
            <FolderOpen className="h-4 w-4 text-accent" />
            Open Recent Case
          </button>
          <button
            data-testid="import-case-btn"
            onClick={onImportCase}
            className="flex items-center gap-2 px-5 py-3 border border-border-strong hover:border-accent hover:bg-accent-subtle text-text-primary font-display font-semibold text-sm rounded-2xl transition-[transform,border-color,background-color] active:scale-[0.98]"
          >
            <Archive className="h-4 w-4 text-accent" />
            Import Case…
          </button>
        </div>

        <p className="text-[11px] text-text-faint">
          <kbd className="px-1.5 py-0.5 rounded border border-border-strong bg-surface font-mono text-[10px] font-medium text-text-muted">
            {modifierLabel()}
          </kbd>
          {' + '}
          <kbd className="px-1.5 py-0.5 rounded border border-border-strong bg-surface font-mono text-[10px] font-medium text-text-muted">
            N
          </kbd>
          <span className="ml-1.5">to create · </span>
          <kbd className="px-1.5 py-0.5 rounded border border-border-strong bg-surface font-mono text-[10px] font-medium text-text-muted">
            {modifierLabel()}
          </kbd>
          {' + '}
          <kbd className="px-1.5 py-0.5 rounded border border-border-strong bg-surface font-mono text-[10px] font-medium text-text-muted">
            K
          </kbd>
          <span className="ml-1.5">to search</span>
        </p>
      </div>
    </section>
  )
}
