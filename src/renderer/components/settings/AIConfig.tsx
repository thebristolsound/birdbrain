import type { BirdbrainSettings } from '@shared/types'

export interface AIConfigProps {
  settings: BirdbrainSettings
  onUpdate: (partial: Partial<BirdbrainSettings>) => Promise<void>
}

export function AIConfig() {
  return (
    <section className="neu-card rounded-2xl p-5">
      <h2 className="mb-4 text-lg font-semibold text-text-primary">AI Configuration</h2>
      <p className="text-sm text-text-muted">AI features are being redesigned. Stay tuned.</p>
    </section>
  )
}
