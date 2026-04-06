import { useEffect, useState } from 'react'

export function OperatorConfig() {
  const [installationId, setInstallationId] = useState('')
  const [operatorName, setOperatorName] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    window.birdbrain.settings.getIdentity().then((id) => {
      setInstallationId(id.installationId)
      setOperatorName(id.operatorName)
    })
  }, [])

  async function save() {
    setSaving(true)
    try {
      await window.birdbrain.settings.update({ operatorName })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="mb-1 block text-xs font-medium text-text-secondary">
          Operator Name
        </label>
        <input
          type="text"
          value={operatorName}
          onChange={(e) => setOperatorName(e.target.value)}
          onBlur={save}
          placeholder="e.g. Det. Smith"
          className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary"
        />
        <p className="mt-1 text-[11px] text-text-muted">
          Recorded in every capture's audit manifest. Leave blank for device-only attribution.
        </p>
        {saving && <p className="text-[11px] text-text-faint">Saving...</p>}
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-text-secondary">
          Installation ID
        </label>
        <input
          type="text"
          readOnly
          value={installationId}
          className="w-full rounded-lg border border-border bg-elevated px-3 py-2 font-mono text-[11px] text-text-muted"
        />
        <p className="mt-1 text-[11px] text-text-muted">
          Stable device identifier - stamped on every capture. Cannot be changed.
        </p>
      </div>
    </div>
  )
}
