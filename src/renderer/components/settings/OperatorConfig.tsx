import { useState, useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { identityQueryOptions, useSettingsMutations } from '@renderer/lib/queries'
import { Input, Label } from '@renderer/components/ui'

export function OperatorConfig() {
  const { data: identity } = useQuery(identityQueryOptions)
  const [operatorName, setOperatorName] = useState('')
  const [operatorRole, setOperatorRole] = useState('')
  const [operatorOrganization, setOperatorOrganization] = useState('')
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

  async function save() {
    if (!operatorName.trim()) {
      setNameError('Operator name is required for capture and export.')
      return
    }
    setNameError('')
    await update.mutateAsync({ operatorName, operatorRole, operatorOrganization })
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
