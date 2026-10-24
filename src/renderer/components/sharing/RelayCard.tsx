import { useId, useState, type Ref } from 'react'
import { Card, Input, SectionLabel } from '@renderer/components/ui'
import { sharingErrorCode, useSharingMutations } from '@renderer/lib/api/sharing'
import { COPY, refusalMessage } from '@renderer/components/sharing/memberModel'

interface RelayCardProps {
  // settings.sharingRelayUrl; '' means the default public relays. Mount with
  // `key={relayUrl}` so a save made elsewhere resets the field.
  relayUrl: string
  inputRef?: Ref<HTMLInputElement>
}

// The relay setting (#1514, mock 1a) without the mock's "Test" button: no
// channel tests a relay. Saved on blur or Enter when the value changed.
export function RelayCard({ relayUrl, inputRef }: RelayCardProps) {
  const id = useId()
  const { setRelayUrl } = useSharingMutations()
  const [value, setValue] = useState(relayUrl)
  const [error, setError] = useState<string | null>(null)

  function save() {
    const next = value.trim()
    if (next === relayUrl) return
    setRelayUrl.mutate(next, {
      onSuccess: () => setError(null),
      onError: (err) =>
        setError(
          refusalMessage(sharingErrorCode(err), err instanceof Error ? err.message : String(err))
        )
    })
  }

  return (
    <Card className="p-4" data-testid="relay-card">
      <SectionLabel className="mb-3">Relay</SectionLabel>
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-text-primary">
        {COPY.relayUrlLabel}
      </label>
      <Input
        id={id}
        ref={inputRef}
        type="text"
        className="border-border-strong font-mono"
        placeholder="default relays"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === 'Enter') save()
        }}
      />
      <p className="mt-1.5 text-[11px] text-text-muted">
        Restart Birdbrain to use a changed relay address.
      </p>
      {error ? (
        <p className="mt-1.5 text-[11px] text-danger-fg" data-testid="relay-error">
          {error}
        </p>
      ) : null}
      <p className="mt-2 text-[11px] leading-[1.55] text-text-muted">{COPY.relayExplainer}</p>
    </Card>
  )
}
