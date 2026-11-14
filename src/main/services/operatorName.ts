import { getSettings } from '@main/services/settings'

// The operator gate (X47) that capture admission, recapture, duplicate, Capture deletion, the
// Staging Pool commit, the trusted-time worker, the Shared Case pull and the Exhibit backfill
// pass before they sign a Manifest Entry; the lifecycle's ingest refuses a blank name it is
// handed as well. Each refuses when this is empty, the backfill at each branch that signs,
// and none signs a placeholder in its place: a placeholder would be a signed claim that
// nobody made the entry.
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
