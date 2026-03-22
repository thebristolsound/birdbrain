// Shared extension types — single source of truth within the extension.
// These mirror the Selector/SelectorMatch/ActiveCaseSelectors types in
// src/shared/types.ts but cannot import them directly because the
// extension builds separately with its own Vite config.

export interface SelectorInfo {
  id: string
  caseId: string
  pattern: string
  isRegex: boolean
  enabled: boolean
  label?: string
  createdAt?: string
}

export interface ActiveCaseSelectors {
  caseId: string
  caseName: string
  selectors: SelectorInfo[]
}

export interface SelectorMatchInfo {
  selectorId: string
  caseId: string
  caseName: string
  pattern: string
  matchText: string
  context: string
  index: number
}
