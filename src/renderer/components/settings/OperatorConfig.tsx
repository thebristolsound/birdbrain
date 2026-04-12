import { useEffect, useState } from 'react'
import { Input, Label } from '@renderer/components/ui'

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
        <Label className="text-xs font-medium text-text-secondary">Operator Name</Label>
        <Input
          type="text"
          value={operatorName}
          onChange={(e) => setOperatorName(e.target.value)}
          onBlur={save}
          placeholder="e.g. Det. Smith"
          className="border-border bg-surface"
        />
        <p className="mt-1 text-[11px] text-text-muted">
          Recorded in every capture's audit manifest. Leave blank for device-only attribution.
        </p>
        {saving && <p className="text-[11px] text-text-faint">Saving...</p>}
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
          Stable device identifier - stamped on every capture. Cannot be changed.
        </p>
      </div>
    </div>
  )
}
