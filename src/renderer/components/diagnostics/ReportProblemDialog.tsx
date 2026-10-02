import { useState } from 'react'
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  Label,
  Textarea
} from '@renderer/components/ui'
import { notify } from '@renderer/lib/notify'
import { createBugReport } from '@renderer/lib/api/diagnostics'

interface ReportProblemDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  correlationId?: string
}

// Mirrors BUG_REPORT_ENTRIES in src/main/services/bugReport.ts. Restated here
// rather than imported — the renderer must not import a main-process module
// (see eslint's import boundary for src/main), so this list is the disclosure
// contract's renderer-side copy. If bugReport.ts's entry list ever changes,
// this must change with it for the "what's included" disclosure to stay true.
// birdbrain.log and birdbrain.log.1 collapse into one display line below,
// since .1 is the same log rotated out at its size cap.
const DISCLOSURE_ITEMS: Array<{ name: string; detail: string }> = [
  {
    name: 'report.md',
    detail:
      'your description below, when you made it, your app version, platform, and installation identifier, and the log entry ID of the error you are reporting, if any'
  },
  {
    name: 'diagnostics.json',
    detail:
      'app and system versions, performance stats, database size and schema version, how many cases, captures, and other records you have, and whether your signing key is encrypted and timestamping is on'
  },
  { name: 'sessions.json', detail: 'a record of your last 20 app launches (for crash detection)' },
  {
    name: 'birdbrain.log',
    detail: 'the diagnostic log, plus the previous log file if it has rotated'
  }
]

export function ReportProblemDialog({
  open,
  onOpenChange,
  correlationId
}: ReportProblemDialogProps) {
  const [whatYouDid, setWhatYouDid] = useState('')
  const [whatYouExpected, setWhatYouExpected] = useState('')
  const [whatHappened, setWhatHappened] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(): Promise<void> {
    setSubmitting(true)
    try {
      const result = await createBugReport({
        whatYouDid,
        whatYouExpected,
        whatHappened,
        correlationId
      })
      // null means the tester cancelled the save-file dialog — leave this
      // dialog open with what they typed intact so they can try again.
      if (result) onOpenChange(false)
    } catch (cause) {
      // An unwritable destination, a full disk, or a failure building the zip
      // rejects here. Without this catch the rejection is unhandled (the submit
      // handler is invoked with `void`), the dialog just stops spinning, and the
      // tester is given no reason and no next step — in the one workflow whose
      // entire job is reporting that something went wrong. notify.error is both
      // visible and durable, so the failure to file a report is itself in the
      // log. The dialog stays open and the typed text is untouched.
      notify.error('Could not save the diagnostic report. Try a different folder.', {
        code: 'app.bug_report_failed',
        cause
      })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onClose={() => onOpenChange(false)} className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Report a problem</DialogTitle>
          <DialogDescription>
            Describe what happened, then save a bundle to attach to your issue.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label htmlFor="report-what-did">What did you do?</Label>
            <Textarea
              id="report-what-did"
              rows={2}
              value={whatYouDid}
              onChange={(e) => setWhatYouDid(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="report-what-expected">What did you expect?</Label>
            <Textarea
              id="report-what-expected"
              rows={2}
              value={whatYouExpected}
              onChange={(e) => setWhatYouExpected(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="report-what-happened">What happened?</Label>
            <Textarea
              id="report-what-happened"
              rows={2}
              value={whatHappened}
              onChange={(e) => setWhatHappened(e.target.value)}
            />
          </div>

          <div className="rounded-md border border-border bg-surface p-3 text-xs text-text-muted">
            <p className="mb-1.5 font-medium text-text-secondary">This bundle will contain:</p>
            <ul className="list-inside list-disc space-y-0.5">
              {DISCLOSURE_ITEMS.map(({ name, detail }) => (
                <li key={name}>
                  <span className="font-mono text-text-secondary">{name}</span> — {detail}
                </li>
              ))}
            </ul>
            <p className="mt-2">
              No captures, no case database, and no settings file are included. Birdbrain saves this
              file on your computer and never sends it anywhere. You attach it to the issue
              yourself.
            </p>
            <p className="mt-2">
              Your installation identifier is also recorded on every capture you take, so attaching
              this file to a public issue links that issue to evidence you export.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" onClick={() => void handleSubmit()} disabled={submitting}>
            {submitting ? 'Creating…' : 'Create report'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
