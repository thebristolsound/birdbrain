import { useEffect, useState } from 'react'
import { Input, Label } from '@renderer/components/ui'

export function OperatorConfig() {
  const [installationId, setInstallationId] = useState('')
  const [operatorName, setOperatorName] = useState('')
  const [operatorRole, setOperatorRole] = useState('')
  const [operatorOrganization, setOperatorOrganization] = useState('')
  const [saving, setSaving] = useState(false)
  const [nameError, setNameError] = useState('')

  useEffect(() => {
    async function loadIdentity() {
      try {
        const id = await window.birdbrain.settings.getIdentity()
        setInstallationId(id.installationId)
        setOperatorName(id.operatorName)
        setOperatorRole(id.operatorRole)
        setOperatorOrganization(id.operatorOrganization)
      } catch (err) {
        console.error('Failed to load operator identity:', err)
      }
    }
    loadIdentity()
  }, [])

  async function save() {
    if (!operatorName.trim()) {
      setNameError('Operator name is required for capture and export.')
      return
    }
    setNameError('')
    setSaving(true)
    try {
      await window.birdbrain.settings.update({ operatorName, operatorRole, operatorOrganization })
    } finally {
      setSaving(false)
    }
  }

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
            Required. Recorded in every capture and export report.
          </p>
        )}
        {saving && <p className="text-[11px] text-text-faint">Saving...</p>}
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
          value={installationId}
          className="font-mono text-[11px] text-text-muted"
        />
        <p className="mt-1 text-[11px] text-text-muted">
          Stable device identifier - stamped on every capture and export. Cannot be changed.
        </p>
      </div>
    </div>
  )
}
