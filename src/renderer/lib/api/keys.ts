export const queryKeys = {
  cases: ['cases'] as const,
  session: ['session'] as const,
  case: (id: string) => ['cases', id] as const,
  caseAutoCapturePolicy: (id: string) => ['cases', id, 'autoCapturePolicy'] as const,
  recentActivity: (limit: number) => ['cases', 'recentActivity', limit] as const,
  // Prefix over every page size, for invalidating the feed without knowing it.
  recentActivityAll: ['cases', 'recentActivity'] as const,
  captures: (caseId: string) => ['captures', caseId] as const,
  captureContent: (captureId: string, type: 'html' | 'png' | 'txt') =>
    ['captures', 'content', captureId, type] as const,
  captureThumbnail: (captureId: string) => ['captures', 'thumbnail', captureId] as const,
  captureMhtmlUrl: (captureId: string) => ['captures', 'mhtmlUrl', captureId] as const,
  captureHtmlUrl: (captureId: string) => ['captures', 'htmlUrl', captureId] as const,
  captureLinks: (captureId: string) => ['captures', 'links', captureId] as const,
  captureMatchingSelectors: (captureId: string) =>
    ['captures', 'matchingSelectors', captureId] as const,
  captureCounts: ['captureCounts'] as const,
  captureFavorites: (caseId: string) => ['captures', 'favorites', caseId] as const,
  search: (caseId: string, query: string) => ['search', caseId, query] as const,
  tags: ['tags'] as const,
  tagsForCapture: (captureId: string) => ['tags', 'capture', captureId] as const,
  tagCountForCase: (caseId: string) => ['tags', 'caseCount', caseId] as const,
  tagUsageCounts: (caseId: string) => ['tags', 'usageCounts', caseId] as const,
  tagCaptureMatrix: (caseId: string) => ['tags', 'captureMatrix', caseId] as const,
  // Prefix over every case and tag set, for invalidating the capture list's
  // tag filter after a membership write without knowing what it is narrowed by.
  tagCapturesWithAnyAll: ['tags', 'capturesWithAnyTag'] as const,
  tagCapturesWithAny: (caseId: string, tagIds: string[]) =>
    ['tags', 'capturesWithAnyTag', caseId, ...tagIds] as const,
  // How many of a selection carry each tag (#665). The ids are sorted into the
  // key so the same set reached in a different click order is one cache entry,
  // and nested as one array segment so the prefix below stays two elements.
  tagSelectionCountsAll: ['tags', 'selectionCounts'] as const,
  tagSelectionCounts: (caseId: string, captureIds: string[]) =>
    ['tags', 'selectionCounts', caseId, [...captureIds].sort()] as const,
  tagsForNote: (noteId: string) => ['tags', 'note', noteId] as const,
  personas: ['persona'] as const,
  personaStorageState: ['persona', 'storageState'] as const,
  selectors: (caseId: string) => ['selectors', caseId] as const,
  selectorMatchCounts: (caseId: string) => ['selectors', 'matchCounts', caseId] as const,
  selectorCoverage: (caseId: string) => ['selectors', 'coverage', caseId] as const,
  selectorCaptureMatrix: (caseId: string) => ['selectors', 'captureMatrix', caseId] as const,
  selectorMatchingCapturesAll: (caseId: string) =>
    ['selectors', 'matchingCaptures', caseId] as const,
  selectorMatchingCaptures: (caseId: string, selectorIds: string[]) =>
    ['selectors', 'matchingCaptures', caseId, ...selectorIds] as const,
  notes: (caseId: string) => ['notes', caseId] as const,
  noteCount: (caseId: string) => ['notes', 'count', caseId] as const,
  notesSearch: (caseId: string, query: string) => ['notes', 'search', caseId, query] as const,
  noteReferenceEdges: (caseId: string) => ['notes', 'referenceEdges', caseId] as const,
  extractedDataCategories: (caseId: string) => ['extractedData', 'categories', caseId] as const,
  extractedDataSubcategories: (caseId: string, category: string) =>
    ['extractedData', 'subcategories', caseId, category] as const,
  extractedDataItems: (caseId: string, category: string, subcategory: string) =>
    ['extractedData', 'items', caseId, category, subcategory] as const,
  extractedDataCount: (caseId: string) => ['extractedData', 'count', caseId] as const,
  extractedDataSearch: (caseId: string, query: string) =>
    ['extractedData', 'search', caseId, query] as const,
  annotations: (captureId: string) => ['annotations', captureId] as const,
  // The Exhibit model's read paths (ADR-0023). One inventory per case, one
  // manifest snapshot per case; a verify result is keyed per Exhibit so the
  // Integrity Exceptions view can read the latest outcome without a refetch.
  exhibitInventory: (caseId: string) => ['exhibits', 'inventory', caseId] as const,
  exhibitVerification: (caseId: string, exhibitId: string) =>
    ['exhibits', 'verification', caseId, exhibitId] as const,
  manifestSnapshot: (caseId: string) => ['manifest', 'snapshot', caseId] as const,
  waybackLookup: (captureId: string) => ['wayback', 'lookup', captureId] as const,
  waybackPins: (captureId: string) => ['wayback', 'pins', captureId] as const,
  waybackCasePins: (caseId: string) => ['wayback', 'casePins', caseId] as const,
  settings: ['settings'] as const,
  identity: ['identity'] as const,
  appVersion: ['appVersion'] as const,
  exportPreflight: (caseId: string, captureIds?: string[]) =>
    ['export', 'preflight', caseId, captureIds ?? null] as const,
  recaptureQueue: ['recaptureQueue'] as const,
  diagnostics: ['diagnostics'] as const,
  unreconciledDeletions: ['diagnostics', 'unreconciledDeletions'] as const,
  dbStats: ['db', 'stats'] as const,
  dbSnapshots: ['db', 'snapshots'] as const,
  dbTableRows: (table: string, offset: number, limit: number) =>
    ['db', 'tableRows', table, offset, limit] as const
}
