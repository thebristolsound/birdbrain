import { Archive, ChevronRight, Folder, Users, type LucideIcon } from 'lucide-react'
import { Card } from '@renderer/components/ui'
import { useCaseArchiveImport } from '@renderer/components/dashboard/cases/useCaseArchiveImport'
import { ImportCaseDialog } from '@renderer/components/dashboard/cases/ImportCaseDialog'

// The New Case wizard's start step (#1514, the shared-case members mock 1d).
export function CaseStartStep({ onBlank, onJoin }: { onBlank: () => void; onJoin: () => void }) {
  const { report: importReport, error: importError, start, close } = useCaseArchiveImport()

  return (
    <Card className="mx-auto w-full max-w-[480px] p-6" data-testid="case-start-step">
      <h2 className="font-display text-lg font-extrabold tracking-tight text-text-primary">
        Start a Case
      </h2>
      <p className="mt-1 text-xs text-text-muted">Choose how this Case begins.</p>
      <div className="mt-5 flex flex-col gap-2">
        <StartOption
          testId="case-start-blank"
          icon={Folder}
          title="Blank Case"
          subtitle="Name it and start capturing"
          onClick={onBlank}
        />
        <StartOption
          testId="case-start-import"
          icon={Archive}
          title="Import a Case Archive"
          subtitle="A one-time copy from a .birdbrain file"
          onClick={start}
        />
        <StartOption
          testId="case-start-join"
          icon={Users}
          title="Join a shared Case"
          subtitle="Paste an invite from the Case’s Owner. Stays in sync."
          onClick={onJoin}
        />
      </div>
      {importError && (
        <div
          role="alert"
          className="mt-4 rounded border border-danger-line bg-danger-surface px-3 py-2 text-xs text-danger-fg"
        >
          {importError}
        </div>
      )}
      {importReport && <ImportCaseDialog report={importReport} onClose={close} />}
    </Card>
  )
}

function StartOption({
  testId,
  icon: Icon,
  title,
  subtitle,
  onClick
}: {
  testId: string
  icon: LucideIcon
  title: string
  subtitle: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-md border border-border bg-card px-3.5 py-3 text-left transition-colors hover:border-accent hover:bg-accent-subtle focus-visible:border-accent focus-visible:bg-accent-subtle focus-visible:outline-none"
    >
      <Icon size={16} className="shrink-0 text-text-muted" />
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-semibold text-text-primary">{title}</span>
        <span className="block text-[11px] text-text-muted">{subtitle}</span>
      </span>
      <ChevronRight size={14} className="shrink-0 text-text-faint" />
    </button>
  )
}
