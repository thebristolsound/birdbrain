import type { Capture } from '@shared/types'

interface Props {
  capture: Capture
  caseId: string
}

export function ForensicsTab({ capture, caseId }: Props) {
  void caseId
  return (
    <div className="h-full overflow-y-auto">
      {capture.format === 'html' && (
        <div
          className="mx-5 mt-4 rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-500"
          data-testid="forensics-legacy-banner"
        >
          Legacy HTML capture — captured before forensic chain (v2). Hash present, chain metadata
          unavailable.
        </div>
      )}
      <Section title="Identity">
        <Row label="URL" value={capture.url} />
        <Row label="Title" value={capture.title} />
      </Section>
    </div>
  )
}

function Section({
  title,
  children,
  action
}: {
  title: string
  children: React.ReactNode
  action?: React.ReactNode
}) {
  return (
    <section className="border-b border-border px-5 py-4 [&:last-child]:border-b-0">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-text-faint">{title}</h3>
        {action}
      </div>
      <div className="space-y-3 font-mono text-xs">{children}</div>
    </section>
  )
}

function Row({ label, value }: { label: string; value: string | number | undefined | null }) {
  if (value === undefined || value === null || value === '') return null
  return (
    <div>
      <div className="text-text-faint">{label}</div>
      <div className="break-all text-text-secondary">{String(value)}</div>
    </div>
  )
}
