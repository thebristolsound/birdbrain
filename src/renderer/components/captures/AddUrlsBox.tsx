import { useState } from 'react'
import { Button, Textarea } from '@renderer/components/ui'
import { useRecaptureMutations } from '@renderer/lib/queries'

interface AddUrlsBoxProps {
  caseId: string
  onQueued?: () => void
}

interface Feedback {
  summary: string
  rejected: Array<{ url: string; reason: string }>
}

// One entry per line. Splitting on any whitespace turned one malformed line
// into several rejections, none of which matched what the operator pasted.
function parseUrlEntries(value: string): string[] {
  return [
    ...new Set(
      value
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean)
    )
  ]
}

// Paste one or many URLs, one per line; they are captured silently in the
// background by the recapture queue. Rendered inside the Capture menu's dialog.
export function AddUrlsBox({ caseId, onQueued }: AddUrlsBoxProps) {
  const [value, setValue] = useState('')
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const { enqueue } = useRecaptureMutations(caseId)

  async function submit() {
    const urls = parseUrlEntries(value)
    if (urls.length === 0) return
    try {
      const { accepted, rejected } = await enqueue.mutateAsync({ urls })
      const parts = [`${accepted} queued`]
      if (rejected.length > 0) parts.push(`${rejected.length} rejected`)
      setFeedback({ summary: parts.join(', '), rejected })
      if (accepted > 0) setValue('')
      // Everything queued cleanly — dismiss the dialog. Keep it open when
      // some URLs were rejected so the feedback stays readable.
      if (accepted > 0 && rejected.length === 0) onQueued?.()
    } catch (err) {
      setFeedback({
        summary: err instanceof Error ? err.message : 'Failed to queue captures',
        rejected: []
      })
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-start gap-2">
        <Textarea
          data-testid="add-urls-input"
          className="min-h-0 flex-1 resize-y py-1.5 text-xs"
          placeholder="Paste URLs to capture in the background, one per line..."
          rows={4}
          value={value}
          onChange={(e) => {
            setValue(e.target.value)
            setFeedback(null)
          }}
        />
        <Button
          variant="outline"
          size="sm"
          data-testid="add-urls-submit"
          disabled={enqueue.isPending || value.trim() === ''}
          onClick={submit}
        >
          Capture
        </Button>
      </div>
      {feedback && (
        <div data-testid="add-urls-feedback" className="text-xs text-text-secondary">
          <span>{feedback.summary}</span>
          {feedback.rejected.length > 0 && (
            <ul data-testid="add-urls-rejections" className="mt-1 flex flex-col gap-0.5">
              {feedback.rejected.map(({ url, reason }) => (
                <li key={url} className="min-w-0 break-all text-text-muted">
                  <span className="font-mono text-text-secondary">{url}</span>: {reason}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
