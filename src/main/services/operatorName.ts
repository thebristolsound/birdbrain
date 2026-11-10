import { getSettings } from '@main/services/settings'

// The operator gate (X47) that ingest, duplicate, Capture deletion, the Staging Pool commit,
// the trusted-time worker and the Exhibit backfill pass before they sign a Manifest Entry. Each
// refuses when this is empty, and none signs a placeholder in its place: a placeholder would
// be a signed claim that nobody made the entry.
export function trimmedOperatorName(): string {
  return getSettings().operatorName?.trim() ?? ''
}

// A signing path refused because no operator name is set. Carried as a throw only where the
// caller's result has no refusal shape to put it in; everywhere else it is an outcome.
export class OperatorNameRequiredError extends Error {
  constructor() {
    super('Operator name required')
    this.name = 'OperatorNameRequiredError'
  }
}
