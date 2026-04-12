import type { BirdbrainSettings } from '@shared/types'

export interface AIConfigProps {
  settings: BirdbrainSettings
  onUpdate: (partial: Partial<BirdbrainSettings>) => Promise<void>
}

import { Card, CardContent } from '@renderer/components/ui'

export function AIConfig() {
  return (
    <Card>
      <CardContent>
        <h2 className="mb-4 text-lg font-semibold text-text-primary">AI Configuration</h2>
        <p className="text-sm text-text-muted">AI features are being redesigned. Stay tuned.</p>
      </CardContent>
    </Card>
  )
}
