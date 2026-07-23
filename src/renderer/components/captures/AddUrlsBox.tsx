import { useState } from 'react'
import { Button, Textarea } from '@renderer/components/ui'
import { useRecaptureMutations } from '@renderer/lib/queries'

interface AddUrlsBoxProps {
  caseId: string
  onQueued?: () => void
}

// Paste one or many URLs (whitespace-separated); they are captured
// silently in the background by the recapture queue. Rendered inside the
// Capture menu's dialog.
export function AddUrlsBox({ caseId, onQueued }: AddUrlsBoxProps) {
  const [value, setValue] = useState('')
  const [feedback, setFeedback] = useState<string | null>(null)
  const { enqueue } = useRecaptureMutations(caseId)

  async function submit() {
    const urls = [
      ...new Set(
        value
          .split(/\s+/)
          .map((s) => s.trim())
          .filter(Boolean)
      )
    ]
    if (urls.length === 0) return
    try {
      const result = await enqueue.mutateAsync({ urls })
      const parts = [`${result.accepted} queued`]
      if (result.rejected.length > 0) {
        parts.push(`${result.rejected.length} rejected (${result.rejected[0].reason})`)
      }
      setFeedback(parts.join(', '))
      if (result.accepted > 0) setValue('')
      // Everything queued cleanly — dismiss the dialog. Keep it open when
      // some URLs were rejected so the feedback stays readable.
      if (result.accepted > 0 && result.rejected.length === 0) onQueued?.()
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Failed to queue captures')
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex gap-2">
        <Textarea
          data-testid="add-urls-input"
          className="min-h-0 flex-1 resize-y py-1.5 text-xs"
          placeholder="Paste URLs to capture in the background..."
          rows={1}
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
        <span data-testid="add-urls-feedback" className="text-xs text-text-secondary">
          {feedback}
        </span>
      )}
    </div>
  )
}
