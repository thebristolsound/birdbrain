import { useState, useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  identityQueryOptions,
  settingsQueryOptions,
  useSettingsMutations
} from '@renderer/lib/queries'
import { Card, CardContent, Input, Label } from '@renderer/components/ui'
import { cn } from '@renderer/lib/utils'
import { DEFAULT_TSA_URL } from '@shared/constants'
import { parseTsaUrl } from '@shared/schemas'

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
              Operator Name <span className="text-red-500">*</span>
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
              className={`border-border bg-surface${nameError ? ' border-red-500' : ''}`}
            />
            {nameError ? (
              <p id="operator-name-error" role="alert" className="mt-1 text-[11px] text-red-500">
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
              className="border-border bg-surface"
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
              className="border-border bg-surface"
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
              className={cn(
                'border-border bg-surface font-mono text-[11px]',
                tsaError && 'border-red-500'
              )}
            />
            {tsaError && (
              <p id="operator-tsa-error" role="alert" className="mt-1 text-[11px] text-red-500">
                {tsaError}
              </p>
            )}
            <p className="mt-1 text-[11px] text-text-muted">
              {tsaEnabled
                ? 'RFC 3161 timestamp server. Defaults to DigiCert. Each request discloses the capture content hash, this device’s IP address and the time of the request to that authority.'
                : 'Not in use while trusted timestamping is off. Nothing is sent to this endpoint.'}
            </p>
          </div>
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
