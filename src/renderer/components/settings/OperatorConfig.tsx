import { useState, useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  identityQueryOptions,
  settingsQueryOptions,
  useSettingsMutations
} from '@renderer/lib/queries'
import { Card, CardContent, Input, Label } from '@renderer/components/ui'
import { cn } from '@renderer/lib/utils'
import { DEFAULT_TSA_URL, TOR_PROXY_PRESETS } from '@shared/constants'
import { parseProxyUrl, parseTsaUrl } from '@shared/schemas'
import type { EgressKind, EgressSetting, KnownEgress } from '@shared/types'

export function OperatorConfig() {
  const { data: identity } = useQuery(identityQueryOptions)
  const { data: settings } = useQuery(settingsQueryOptions)
  const [operatorName, setOperatorName] = useState('')
  const [operatorRole, setOperatorRole] = useState('')
  const [operatorOrganization, setOperatorOrganization] = useState('')
  const [tsaUrl, setTsaUrl] = useState('')
  const [nameError, setNameError] = useState('')
  const [tsaError, setTsaError] = useState('')
  const initialized = useRef(false)
  const { update } = useSettingsMutations()

  // Initialize state from identity once when it first loads
  useEffect(() => {
    if (identity && !initialized.current) {
      setOperatorName(identity.operatorName)
      setOperatorRole(identity.operatorRole)
      setOperatorOrganization(identity.operatorOrganization)
      initialized.current = true
    }
  }, [identity])

  // tsaUrl lives in full settings (not identity); seed it once settings load.
  const tsaInitialized = useRef(false)
  useEffect(() => {
    if (settings && !tsaInitialized.current) {
      setTsaUrl(settings.tsaUrl)
      tsaInitialized.current = true
    }
  }, [settings])

  async function save() {
    if (!operatorName.trim()) {
      setNameError('Operator name is required for capture and export.')
      return
    }
    setNameError('')
    await update.mutateAsync({ operatorName, operatorRole, operatorOrganization })
  }

  // An invalid address is refused here and by main (#1522), and the typed text
  // stays so it can be corrected. Clearing the field asks for the default.
  async function saveTsaUrl() {
    if (tsaUrl.trim() && parseTsaUrl(tsaUrl) === null) {
      setTsaError('Not an http:// or https:// address. The saved authority has not changed.')
      return
    }
    try {
      const saved = await update.mutateAsync({ tsaUrl: tsaUrl.trim() || DEFAULT_TSA_URL })
      setTsaUrl(saved.tsaUrl)
      setTsaError('')
    } catch {
      setTsaError('The address could not be saved.')
    }
  }

  // Written straight through rather than mirrored into local state: the switch
  // renders the persisted value, so a failed write cannot leave the control
  // showing an opt-out that was never saved (#1169).
  const tsaEnabled = settings?.tsaEnabled ?? true
  async function toggleTsaEnabled() {
    await update.mutateAsync({ tsaEnabled: !tsaEnabled })
  }

  if (!identity) return <div className="text-text-muted">Loading...</div>

  return (
    <Card>
      <CardContent>
        <h2 className="mb-4 font-display text-[10px] font-semibold uppercase tracking-wider text-text-faint">
          Operator
        </h2>
        <div className="flex max-w-[560px] flex-col gap-4">
          <div>
            <Label htmlFor="operator-name" className="text-xs font-medium text-text-secondary">
              Operator Name <span className="text-danger-fg">*</span>
            </Label>
            <Input
              id="operator-name"
              type="text"
              value={operatorName}
              onChange={(e) => {
                setOperatorName(e.target.value)
                if (e.target.value.trim()) setNameError('')
              }}
              onBlur={save}
              placeholder="e.g. Alex Smith"
              aria-invalid={nameError ? true : undefined}
              aria-describedby={nameError ? 'operator-name-error' : undefined}
              className={`bg-surface${nameError ? ' border-red-500' : ''}`}
            />
            {nameError ? (
              <p id="operator-name-error" role="alert" className="mt-1 text-[11px] text-danger-fg">
                {nameError}
              </p>
            ) : (
              <p className="mt-1 text-[11px] text-text-muted">
                Required. Recorded in every capture's audit manifest and export report.
              </p>
            )}
            {update.isPending && <p className="text-[11px] text-text-faint">Saving...</p>}
          </div>
          <div>
            <Label htmlFor="operator-role" className="text-xs font-medium text-text-secondary">
              Role
            </Label>
            <Input
              id="operator-role"
              type="text"
              value={operatorRole}
              onChange={(e) => setOperatorRole(e.target.value)}
              onBlur={save}
              placeholder="e.g. Researcher, Analyst"
              className="bg-surface"
            />
            <p className="mt-1 text-[11px] text-text-muted">
              Optional. Included in the export report.
            </p>
          </div>
          <div>
            <Label
              htmlFor="operator-organization"
              className="text-xs font-medium text-text-secondary"
            >
              Organization
            </Label>
            <Input
              id="operator-organization"
              type="text"
              value={operatorOrganization}
              onChange={(e) => setOperatorOrganization(e.target.value)}
              onBlur={save}
              placeholder="e.g. Independent Research Group"
              className="bg-surface"
            />
            <p className="mt-1 text-[11px] text-text-muted">
              Optional. Included in the export report.
            </p>
          </div>
          <div>
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-xs font-medium text-text-secondary">Trusted timestamping</div>
                {/* Scoped to captures made while the switch is off (#1169 review):
                    tokens obtained earlier stay valid and their captures keep
                    asserting trusted time in the badge and in every export, so a
                    flat "no trusted time is asserted" would misdescribe evidence
                    the operator already holds. */}
                <p className="mt-1 text-[11px] text-text-muted">
                  With this off, nothing is sent to a timestamp authority and captures made while it
                  is off assert no trusted time; they are timestamped if you turn it back on.
                  Timestamps already obtained are kept.
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={tsaEnabled}
                aria-label="Trusted timestamping"
                onClick={toggleTsaEnabled}
                className={cn(
                  'relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors',
                  tsaEnabled ? 'bg-accent' : 'bg-text-faint'
                )}
              >
                <span
                  className={cn(
                    'inline-block h-3.5 w-3.5 rounded-full bg-accent-foreground transition-transform',
                    tsaEnabled ? 'translate-x-[18px]' : 'translate-x-0.5'
                  )}
                />
              </button>
            </div>
          </div>
          <div>
            <Label htmlFor="operator-tsa" className="text-xs font-medium text-text-secondary">
              Trusted Timestamp Authority
            </Label>
            {/* Editable while timestamping is off (#1169 review). Disabling it
                forced the only order that can leak: an operator wanting a
                different authority had to switch timestamping on first, and the
                worker's retry tick or the next capture could reach the old
                endpoint before the new URL was typed and saved on blur. Nothing
                is sent while the switch is off, so editing it here is free. */}
            <Input
              id="operator-tsa"
              type="text"
              value={tsaUrl}
              onChange={(e) => setTsaUrl(e.target.value)}
              onBlur={saveTsaUrl}
              placeholder={DEFAULT_TSA_URL}
              aria-invalid={tsaError ? true : undefined}
              aria-describedby={tsaError ? 'operator-tsa-error' : undefined}
              className={cn('bg-surface font-mono text-[11px]', tsaError && 'border-red-500')}
            />
            {tsaError && (
              <p id="operator-tsa-error" role="alert" className="mt-1 text-[11px] text-danger-fg">
                {tsaError}
              </p>
            )}
            <p className="mt-1 text-[11px] text-text-muted">
              {tsaEnabled
                ? 'RFC 3161 timestamp server. Defaults to DigiCert. Each request discloses the capture content hash, this device’s IP address and the time of the request to that authority.'
                : 'Not in use while trusted timestamping is off. Nothing is sent to this endpoint.'}
            </p>
          </div>
          <EgressSettings stored={settings?.egress ?? { kind: 'direct' }} />
          <div>
            <Label
              htmlFor="operator-installation"
              className="text-xs font-medium text-text-secondary"
            >
              Installation ID
            </Label>
            <Input
              id="operator-installation"
              type="text"
              readOnly
              value={identity.installationId}
              className="font-mono text-[11px] text-text-muted"
            />
            <p className="mt-1 text-[11px] text-text-muted">
              Stable device identifier - stamped on every capture and export. Cannot be changed.
            </p>
          </div>
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

// The Egress (ADR-0032). Direct saves at once; a Proxy or Tor saves once its
// address parses, on blur or on a preset, so a half-typed address is never the
// route. Main refuses the same addresses this does. An Egress the settings file no
// longer shows checks no choice until the Operator makes one.
function EgressSettings({ stored }: { stored: EgressSetting }) {
  const { update } = useSettingsMutations()
  const routed = stored.kind === 'proxy' || stored.kind === 'tor' ? stored : null
  const [kind, setKind] = useState<KnownEgress['kind'] | null>(
    stored.kind === 'unavailable' ? null : stored.kind
  )
  const [proxyUrl, setProxyUrl] = useState(routed?.proxyUrl ?? '')
  const [label, setLabel] = useState(routed?.label ?? '')
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
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

  async function save(next: KnownEgress) {
    try {
      await update.mutateAsync({ egress: next })
      setError('')
      setNote('')
    } catch {
      setError('The Egress could not be saved. The saved Egress has not changed.')
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
    </div>
  )
}
