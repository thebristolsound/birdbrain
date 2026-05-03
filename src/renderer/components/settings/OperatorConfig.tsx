import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { identityQueryOptions, useSettingsMutations } from '@renderer/lib/queries'
import { Input, Label } from '@renderer/components/ui'

export function OperatorConfig() {
  const { data: identity } = useQuery(identityQueryOptions)
  const [operatorName, setOperatorName] = useState('')
  const { update } = useSettingsMutations()

  // Sync operatorName with identity data when it loads
  if (identity && operatorName !== identity.operatorName) {
    setOperatorName(identity.operatorName)
  }

  async function save() {
    await update.mutateAsync({ operatorName })
  }

  if (!identity) return <div className="text-text-muted">Loading...</div>

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
        {update.isPending && <p className="text-[11px] text-text-faint">Saving...</p>}
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
          Stable device identifier - stamped on every capture. Cannot be changed.
        </p>
      </div>
    </div>
  )
}
