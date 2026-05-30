import { useState, useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  identityQueryOptions,
  settingsQueryOptions,
  useSettingsMutations
} from '@renderer/lib/queries'
import { Input, Label } from '@renderer/components/ui'
import { DEFAULT_TSA_URL } from '@shared/constants'

export function OperatorConfig() {
  const { data: identity } = useQuery(identityQueryOptions)
  const { data: settings } = useQuery(settingsQueryOptions)
  const [operatorName, setOperatorName] = useState('')
  const [operatorRole, setOperatorRole] = useState('')
  const [operatorOrganization, setOperatorOrganization] = useState('')
  const [tsaUrl, setTsaUrl] = useState('')
  const [nameError, setNameError] = useState('')
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

  async function saveTsaUrl() {
    // Fall back to the DigiCert default if the field is cleared.
    await update.mutateAsync({ tsaUrl: tsaUrl.trim() || DEFAULT_TSA_URL })
  }

  if (!identity) return <div className="text-text-muted">Loading...</div>

  return (
    <div className="space-y-4">
      <div>
        <Label className="text-xs font-medium text-text-secondary">
          Operator Name <span className="text-red-500">*</span>
        </Label>
        <Input
          type="text"
          value={operatorName}
          onChange={(e) => {
            setOperatorName(e.target.value)
            if (e.target.value.trim()) setNameError('')
          }}
          onBlur={save}
          placeholder="e.g. Det. Smith"
          className={`border-border bg-surface${nameError ? ' border-red-500' : ''}`}
        />
        {nameError ? (
          <p className="mt-1 text-[11px] text-red-500">{nameError}</p>
        ) : (
          <p className="mt-1 text-[11px] text-text-muted">
            Required. Recorded in every capture's audit manifest and export report.
          </p>
        )}
        {update.isPending && <p className="text-[11px] text-text-faint">Saving...</p>}
      </div>
      <div>
        <Label className="text-xs font-medium text-text-secondary">Role</Label>
        <Input
          type="text"
          value={operatorRole}
          onChange={(e) => setOperatorRole(e.target.value)}
          onBlur={save}
          placeholder="e.g. Detective, Analyst"
          className="border-border bg-surface"
        />
        <p className="mt-1 text-[11px] text-text-muted">Optional. Included in the export report.</p>
      </div>
      <div>
        <Label className="text-xs font-medium text-text-secondary">Organization</Label>
        <Input
          type="text"
          value={operatorOrganization}
          onChange={(e) => setOperatorOrganization(e.target.value)}
          onBlur={save}
          placeholder="e.g. Metro Police Department"
          className="border-border bg-surface"
        />
        <p className="mt-1 text-[11px] text-text-muted">Optional. Included in the export report.</p>
      </div>
      <div>
        <Label className="text-xs font-medium text-text-secondary">
          Trusted Timestamp Authority
        </Label>
        <Input
          type="text"
          value={tsaUrl}
          onChange={(e) => setTsaUrl(e.target.value)}
          onBlur={saveTsaUrl}
          placeholder={DEFAULT_TSA_URL}
          className="border-border bg-surface font-mono text-[11px]"
        />
        <p className="mt-1 text-[11px] text-text-muted">
          RFC 3161 endpoint used to trusted-timestamp captures. Defaults to DigiCert. Captures never
          block on it; un-stamped captures are timestamped when the TSA is reachable.
        </p>
      </div>
      <div>
        <Label className="text-xs font-medium text-text-secondary">Installation ID</Label>
        <Input
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
  )
}
