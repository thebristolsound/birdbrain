export const queryKeys = {
  cases: ['cases'] as const,
  session: ['session'] as const,
  case: (id: string) => ['cases', id] as const,
  captures: (caseId: string) => ['captures', caseId] as const,
  captureContent: (captureId: string, type: 'html' | 'png' | 'txt') =>
    ['captures', 'content', captureId, type] as const,
  captureThumbnail: (captureId: string) => ['captures', 'thumbnail', captureId] as const,
  captureMhtmlUrl: (captureId: string) => ['captures', 'mhtmlUrl', captureId] as const,
  captureMatchingSelectors: (captureId: string) =>
    ['captures', 'matchingSelectors', captureId] as const,
  captureCounts: ['captureCounts'] as const,
  captureFavorites: (caseId: string) => ['captures', 'favorites', caseId] as const,
  search: (caseId: string, query: string) => ['search', caseId, query] as const,
  tags: ['tags'] as const,
  tagsForCapture: (captureId: string) => ['tags', 'capture', captureId] as const,
  tagCountForCase: (caseId: string) => ['tags', 'caseCount', caseId] as const,
  tagUsageCounts: (caseId: string) => ['tags', 'usageCounts', caseId] as const,
  selectors: (caseId: string) => ['selectors', caseId] as const,
  selectorMatchCounts: (caseId: string) => ['selectors', 'matchCounts', caseId] as const,
  selectorCoverage: (caseId: string) => ['selectors', 'coverage', caseId] as const,
  selectorMatchingCapturesAll: (caseId: string) =>
    ['selectors', 'matchingCaptures', caseId] as const,
  selectorMatchingCaptures: (caseId: string, selectorIds: string[]) =>
    ['selectors', 'matchingCaptures', caseId, ...selectorIds] as const,
  notes: (caseId: string) => ['notes', caseId] as const,
  noteCount: (caseId: string) => ['notes', 'count', caseId] as const,
  notesSearch: (caseId: string, query: string) => ['notes', 'search', caseId, query] as const,
  extractedDataCategories: (caseId: string) => ['extractedData', 'categories', caseId] as const,
  extractedDataSubcategories: (caseId: string, category: string) =>
    ['extractedData', 'subcategories', caseId, category] as const,
  extractedDataItems: (caseId: string, category: string, subcategory: string) =>
    ['extractedData', 'items', caseId, category, subcategory] as const,
  extractedDataCount: (caseId: string) => ['extractedData', 'count', caseId] as const,
  extractedDataSearch: (caseId: string, query: string) =>
    ['extractedData', 'search', caseId, query] as const,
  annotations: (captureId: string) => ['annotations', captureId] as const,
  waybackLookup: (captureId: string) => ['wayback', 'lookup', captureId] as const,
  waybackPins: (captureId: string) => ['wayback', 'pins', captureId] as const,
  settings: ['settings'] as const,
  identity: ['identity'] as const,
  openRouterModels: ['openRouterModels'] as const,
  appVersion: ['appVersion'] as const,
  captureAnalysis: (captureId: string) => ['analysis', captureId] as const,
  recaptureQueue: ['recaptureQueue'] as const,
  diagnostics: ['diagnostics'] as const,
  dbStats: ['db', 'stats'] as const,
  dbTableRows: (table: string, offset: number, limit: number) =>
    ['db', 'tableRows', table, offset, limit] as const
}
