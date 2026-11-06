import { useState, useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { settingsQueryOptions, useSettingsMutations } from '@renderer/lib/queries'
import {
  Button,
  Card,
  CardContent,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  Input,
  Label
} from '@renderer/components/ui'
import { cn } from '@renderer/lib/utils'
import {
  endLaunchedBrowserSession,
  launchedBrowserName,
  launchedBrowserStatusQueryOptions
} from '@renderer/lib/api/launchedBrowser'
import { TOR_PROXY_PRESETS } from '@shared/constants'
import { parseProxyUrl } from '@shared/schemas'
import type { EgressKind, EgressSetting, KnownEgress } from '@shared/types'

export function NetworkConfig() {
  const { data: settings } = useQuery(settingsQueryOptions)

  if (!settings) return <div className="text-text-muted">Loading...</div>

  return (
    <Card>
      <CardContent>
        <h2 className="mb-4 font-display text-[10px] font-semibold uppercase tracking-wider text-text-faint">
          Network
        </h2>
        <div className="flex max-w-[560px] flex-col gap-4">
          <EgressSettings stored={settings.egress ?? { kind: 'direct' }} />
        </div>
      </CardContent>
    </Card>
  )
}

const EGRESS_CHOICES: Array<[KnownEgress['kind'], string, string]> = [
  [
    'direct',
    'Direct',
    "This device's own connection. A VPN on this device or its network still carries it."
  ],
  [
    'proxy',
    'Proxy',
    "A SOCKS5 or HTTP proxy that needs no login, such as an SSH tunnel or a VPN client's local SOCKS port."
  ],
  [
    'tor',
    'Tor',
    'Your own Tor Browser or Tor service. Tor hides this device’s IP address only: a background capture still names Birdbrain to the site.'
  ]
]

// Saving the Egress it already is tells main's Egress listeners nothing, so it closes no
// launched browser and needs no confirmation.
function sameEgress(stored: EgressSetting, next: KnownEgress): boolean {
  if (stored.kind === 'direct' || stored.kind === 'unavailable' || next.kind === 'direct') {
    return stored.kind === next.kind
  }
  return (
    stored.kind === next.kind && stored.proxyUrl === next.proxyUrl && stored.label === next.label
  )
}

// The Egress (ADR-0032). Direct saves at once; a Proxy or Tor saves once its
// address parses, on blur or on a preset, so a half-typed address is never the
// route. Main refuses the same addresses this does. An Egress the settings file no
// longer shows checks no choice until the Operator makes one.
function EgressSettings({ stored }: { stored: EgressSetting }) {
  const { update } = useSettingsMutations()
  const { data: browserStatus } = useQuery(launchedBrowserStatusQueryOptions)
  const routed = stored.kind === 'proxy' || stored.kind === 'tor' ? stored : null
  const [kind, setKind] = useState<KnownEgress['kind'] | null>(
    stored.kind === 'unavailable' ? null : stored.kind
  )
  const [proxyUrl, setProxyUrl] = useState(routed?.proxyUrl ?? '')
  const [label, setLabel] = useState(routed?.label ?? '')
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  // A change waiting on the Operator (state 14). A launched browser keeps the Egress it launched
  // with, so the change ends its Capture Session and closes it first.
  const [pending, setPending] = useState<{ egress: KnownEgress; browser: string } | null>(null)
  const [ending, setEnding] = useState(false)
  // The choice follows the saved Egress whenever that changes, so a file that
  // stops or starts reading again shows what is in effect. A Proxy chosen with no
  // address yet changes nothing saved, so it stays checked.
  const seen = useRef(JSON.stringify(stored))

  useEffect(() => {
    const key = JSON.stringify(stored)
    if (seen.current === key) return
    seen.current = key
    if (stored.kind === 'unavailable') {
      setKind(null)
      return
    }
    setKind(stored.kind)
    if (stored.kind === 'direct') return
    setProxyUrl(stored.proxyUrl)
    setLabel(stored.label)
  }, [stored])

  function showStored() {
    setKind(stored.kind === 'unavailable' ? null : stored.kind)
    setProxyUrl(routed?.proxyUrl ?? '')
    setLabel(routed?.label ?? '')
  }

  async function write(next: KnownEgress) {
    try {
      await update.mutateAsync({ egress: next })
      setError('')
      setNote('')
    } catch {
      setError('The Egress could not be saved. The saved Egress has not changed.')
    }
  }

  async function save(next: KnownEgress) {
    if (browserStatus?.state === 'open' && !sameEgress(stored, next)) {
      setPending({ egress: next, browser: launchedBrowserName(browserStatus.browser.label) })
      return
    }
    await write(next)
  }

  function keepEgress() {
    setPending(null)
    showStored()
  }

  async function endAndChange(next: KnownEgress) {
    setEnding(true)
    try {
      const after = await endLaunchedBrowserSession()
      const notice = after.state === 'none' ? after.notice : undefined
      if (notice?.code === 'BROWSER_DID_NOT_EXIT') {
        setError(`${notice.message} The saved Egress has not changed.`)
        showStored()
      } else {
        await write(next)
      }
    } catch {
      setError('The Capture Session could not be ended. The saved Egress has not changed.')
      showStored()
    } finally {
      setEnding(false)
      setPending(null)
    }
  }

  async function saveRoute(nextKind: EgressKind, url: string, nextLabel: string) {
    const parsed = parseProxyUrl(url)
    if (!parsed.ok) {
      setError(`${parsed.reason} The saved Egress has not changed.`)
      return
    }
    if (nextKind === 'tor' && !parsed.url.startsWith('socks5://')) {
      setError('Tor takes a socks5:// address. The saved Egress has not changed.')
      return
    }
    setProxyUrl(parsed.url)
    await save({ kind: nextKind, proxyUrl: parsed.url, label: nextLabel.trim() })
  }

  async function choose(next: KnownEgress['kind']) {
    setKind(next)
    setError('')
    setNote('')
    if (next === 'direct') {
      await save({ kind: 'direct' })
      return
    }
    if (next === 'tor' && !proxyUrl.startsWith('socks5://')) {
      await saveRoute('tor', TOR_PROXY_PRESETS[0].proxyUrl, label)
      return
    }
    if (proxyUrl) {
      await saveRoute(next, proxyUrl, label)
      return
    }
    setNote('Enter the proxy address. The saved Egress stays in effect until then.')
  }

  return (
    <div>
      <div className="text-xs font-medium text-text-secondary">Egress</div>
      <p className="mt-1 text-[11px] text-text-muted">
        Where these routes leave from: background captures, the Wayback pane, timestamp requests,
        filter lists and update checks. While it is not Direct, each of these goes through the proxy
        and fails when the proxy is down, with no fallback to this device&rsquo;s connection, and
        the TLS certificate re-fetch after each capture does not run. PDF export of an older HTML
        capture is not routed and can fetch that page&rsquo;s images directly.
      </p>
      {stored.kind === 'unavailable' && (
        <p role="alert" className="mt-1 text-[11px] text-danger-fg">
          The saved Egress could not be read, so Birdbrain sends nothing on these routes until you
          choose one.
        </p>
      )}
      <div className="mt-2 space-y-1" role="radiogroup" aria-label="Egress">
        {EGRESS_CHOICES.map(([value, name, desc]) => (
          <label
            key={value}
            className="flex cursor-pointer items-start gap-2 rounded p-1.5 hover:bg-elevated"
          >
            <input
              type="radio"
              name="egressKind"
              value={value}
              checked={kind === value}
              onChange={() => void choose(value)}
              className="mt-0.5"
            />
            <div>
              <div className="text-sm text-text-secondary">{name}</div>
              <div className="text-xs text-text-muted">{desc}</div>
            </div>
          </label>
        ))}
      </div>
      {(kind === 'proxy' || kind === 'tor') && (
        <div className="mt-2 flex flex-col gap-2">
          <div>
            <Label htmlFor="egress-proxy" className="text-xs font-medium text-text-secondary">
              Proxy address
            </Label>
            <Input
              id="egress-proxy"
              type="text"
              value={proxyUrl}
              onChange={(e) => setProxyUrl(e.target.value)}
              onBlur={() => void saveRoute(kind, proxyUrl, label)}
              placeholder={
                kind === 'tor' ? TOR_PROXY_PRESETS[0].proxyUrl : 'socks5://127.0.0.1:1080'
              }
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? 'egress-error' : undefined}
              className={cn('bg-surface font-mono text-[11px]', error && 'border-red-500')}
            />
            {kind === 'tor' && (
              <div className="mt-1 flex gap-2">
                {TOR_PROXY_PRESETS.map((preset) => (
                  <button
                    key={preset.proxyUrl}
                    type="button"
                    onClick={() => void saveRoute('tor', preset.proxyUrl, label)}
                    className="rounded border border-border px-2 py-0.5 text-[11px] text-text-secondary hover:bg-elevated"
                  >
                    {preset.name} ({preset.proxyUrl.split(':').pop()})
                  </button>
                ))}
              </div>
            )}
          </div>
          <div>
            <Label htmlFor="egress-label" className="text-xs font-medium text-text-secondary">
              Label
            </Label>
            <Input
              id="egress-label"
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              onBlur={() => void saveRoute(kind, proxyUrl, label)}
              placeholder="e.g. Frankfurt VPN"
              className="bg-surface"
            />
            <p className="mt-1 text-[11px] text-text-muted">
              Optional. Each capture Birdbrain renders through this Egress records the label and the
              kind, never the proxy address.
            </p>
          </div>
        </div>
      )}
      {error && (
        <p id="egress-error" role="alert" className="mt-1 text-[11px] text-danger-fg">
          {error}
        </p>
      )}
      {note && !error && <p className="mt-1 text-[11px] text-text-muted">{note}</p>}
      <Dialog open={pending !== null} onOpenChange={(open) => !open && !ending && keepEgress()}>
        {pending && (
          <DialogContent onClose={() => !ending && keepEgress()} className="max-w-sm">
            <DialogTitle>
              {pending.egress.kind === stored.kind
                ? 'Change the Egress?'
                : `Change the Egress to ${egressName(pending.egress.kind)}?`}
            </DialogTitle>
            <DialogDescription className="mt-1 text-xs">
              This ends the Capture Session and closes {pending.browser}.
            </DialogDescription>
            <DialogFooter className="mt-4 gap-1.5">
              <Button variant="outline" disabled={ending} onClick={keepEgress}>
                Cancel
              </Button>
              <Button
                className="text-accent-foreground"
                disabled={ending}
                onClick={() => void endAndChange(pending.egress)}
              >
                {ending ? 'Ending…' : 'End and change'}
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </div>
  )
}

function egressName(kind: KnownEgress['kind']): string {
  const choice = EGRESS_CHOICES.find(([value]) => value === kind)
  return choice ? choice[1] : kind
}
