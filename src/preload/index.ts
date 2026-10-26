import { contextBridge, ipcRenderer } from 'electron'
import type { BirdbrainAPI } from '@shared/birdbrainApi'
import {
  IPC_CHANNELS,
  type ContractedChannel,
  type IpcEventChannel,
  type IpcEventContract,
  type IpcInvokeContract,
  type IpcRefusal
} from '@shared/ipc'

// Every invoke channel is registered through handle(), so every result carries
// the { ok, data | error } envelope. A result without one means the channel was
// registered raw — a wiring bug we surface rather than pass through.
//
// The context bridge copies only an Error's message into the renderer, so a
// `code` set here never arrives. A channel whose callers branch on the code
// rejects with a plain IpcRefusal instead, which crosses whole; the renderer
// turns it back into an Error (refusalError in src/renderer/lib/api/sharing.ts).
async function unwrapIpc<T>(promise: Promise<unknown>, refusal: 'error' | 'object'): Promise<T> {
  const result = await promise
  if (!result || typeof result !== 'object' || !('ok' in result)) {
    throw new Error('IPC result is missing its envelope')
  }
  if ((result as { ok: boolean }).ok) {
    return (result as { ok: true; data: T }).data
  }
  const err = result as { ok: false; error: string; code?: string }
  if (refusal === 'object') {
    const refused: IpcRefusal = { message: err.error, code: err.code }
    throw refused
  }
  const error = new Error(err.error)
  ;(error as unknown as { code?: string }).code = err.code
  throw error
}

// Builds a renderer-facing method for one invoke channel. Both the argument
// tuple and the resolved type come from IpcInvokeContract, so a bridge method
// has no hand-written signature that could drift from its handler.
function bridge<C extends ContractedChannel>(
  channel: C,
  refusal: 'error' | 'object' = 'error'
): (...args: IpcInvokeContract[C]['args']) => Promise<IpcInvokeContract[C]['result']> {
  return (...args) => unwrapIpc(ipcRenderer.invoke(channel, ...args), refusal)
}

// A sharing channel, whose refusals the Members screens tell apart by code.
const refusable = <C extends ContractedChannel>(channel: C) => bridge(channel, 'object')

// Builds a renderer-facing subscribe method for one event channel. The callback
// payload comes from IpcEventContract; the returned function detaches the
// listener, matching the previous per-event helpers.
function subscribe<C extends IpcEventChannel>(
  channel: C
): (callback: (payload: IpcEventContract[C]) => void) => () => void {
  return (callback) => {
    const handler = (_: unknown, payload: IpcEventContract[C]): void => callback(payload)
    ipcRenderer.on(channel, handler)
    return () => {
      ipcRenderer.removeListener(channel, handler)
    }
  }
}

const birdbrain = {
  cases: {
    list: bridge(IPC_CHANNELS.CASES_LIST),
    get: bridge(IPC_CHANNELS.CASES_GET),
    create: bridge(IPC_CHANNELS.CASES_CREATE),
    update: bridge(IPC_CHANNELS.CASES_UPDATE),
    delete: bridge(IPC_CHANNELS.CASES_DELETE),
    deleteDemo: bridge(IPC_CHANNELS.CASES_DELETE_DEMO),
    exportArchive: bridge(IPC_CHANNELS.CASES_EXPORT_ARCHIVE),
    inspectArchive: bridge(IPC_CHANNELS.CASES_INSPECT_ARCHIVE),
    importArchive: bridge(IPC_CHANNELS.CASES_IMPORT_ARCHIVE),
    recentActivity: bridge(IPC_CHANNELS.CASES_RECENT_ACTIVITY),
    getAutoCapturePolicy: bridge(IPC_CHANNELS.CASES_GET_AUTO_CAPTURE_POLICY),
    setAutoCapturePolicy: bridge(IPC_CHANNELS.CASES_SET_AUTO_CAPTURE_POLICY),
    ensureSearchFields: bridge(IPC_CHANNELS.CASES_ENSURE_SEARCH_FIELDS),
    searchFields: bridge(IPC_CHANNELS.CASES_SEARCH_FIELDS),
    checkFieldHit: bridge(IPC_CHANNELS.CASES_CHECK_FIELD_HIT),
    listUnreviewed: bridge(IPC_CHANNELS.CASES_LIST_UNREVIEWED)
  },
  captures: {
    list: bridge(IPC_CHANNELS.CAPTURES_LIST),
    get: bridge(IPC_CHANNELS.CAPTURES_GET),
    delete: bridge(IPC_CHANNELS.CAPTURES_DELETE),
    getContent: bridge(IPC_CHANNELS.CAPTURES_GET_CONTENT),
    getThumbnail: bridge(IPC_CHANNELS.CAPTURES_GET_THUMBNAIL),
    getMatchingSelectors: bridge(IPC_CHANNELS.CAPTURES_GET_MATCHING_SELECTORS),
    download: bridge(IPC_CHANNELS.CAPTURES_DOWNLOAD),
    downloadPdf: bridge(IPC_CHANNELS.CAPTURES_DOWNLOAD_PDF),
    downloadScreenshot: bridge(IPC_CHANNELS.CAPTURES_DOWNLOAD_SCREENSHOT),
    openExternal: bridge(IPC_CHANNELS.CAPTURES_OPEN_EXTERNAL),
    countsByCase: bridge(IPC_CHANNELS.CAPTURES_COUNTS_BY_CASE),
    toggleFavorite: bridge(IPC_CHANNELS.CAPTURES_TOGGLE_FAVORITE),
    isFavorite: bridge(IPC_CHANNELS.CAPTURES_IS_FAVORITE),
    listFavorites: bridge(IPC_CHANNELS.CAPTURES_LIST_FAVORITES),
    verify: bridge(IPC_CHANNELS.CAPTURES_VERIFY),
    getMhtmlUrl: bridge(IPC_CHANNELS.CAPTURES_GET_MHTML_URL),
    getHtmlUrl: bridge(IPC_CHANNELS.CAPTURES_GET_HTML_URL),
    getLinks: bridge(IPC_CHANNELS.CAPTURES_GET_LINKS),
    deleteMany: bridge(IPC_CHANNELS.CAPTURES_DELETE_MANY),
    duplicate: bridge(IPC_CHANNELS.CAPTURES_DUPLICATE),
    setFavoriteMany: bridge(IPC_CHANNELS.CAPTURES_SET_FAVORITE_MANY)
  },
  recapture: {
    enqueue: bridge(IPC_CHANNELS.RECAPTURE_ENQUEUE),
    queueStatus: bridge(IPC_CHANNELS.RECAPTURE_QUEUE_STATUS),
    enqueueCaptures: bridge(IPC_CHANNELS.RECAPTURE_ENQUEUE_CAPTURES)
  },
  tags: {
    list: bridge(IPC_CHANNELS.TAGS_LIST),
    create: bridge(IPC_CHANNELS.TAGS_CREATE),
    update: bridge(IPC_CHANNELS.TAGS_UPDATE),
    delete: bridge(IPC_CHANNELS.TAGS_DELETE),
    addToCapture: bridge(IPC_CHANNELS.TAGS_ADD_TO_CAPTURE),
    removeFromCapture: bridge(IPC_CHANNELS.TAGS_REMOVE_FROM_CAPTURE),
    getForCapture: bridge(IPC_CHANNELS.TAGS_GET_FOR_CAPTURE),
    countForCase: bridge(IPC_CHANNELS.TAGS_COUNT_FOR_CASE),
    usageCountsForCase: bridge(IPC_CHANNELS.TAGS_USAGE_COUNTS_FOR_CASE),
    captureMatrix: bridge(IPC_CHANNELS.TAGS_CAPTURE_MATRIX),
    addToCaptures: bridge(IPC_CHANNELS.TAGS_ADD_TO_CAPTURES),
    removeFromCaptures: bridge(IPC_CHANNELS.TAGS_REMOVE_FROM_CAPTURES),
    countsForCaptures: bridge(IPC_CHANNELS.TAGS_COUNTS_FOR_CAPTURES),
    findOrCreate: bridge(IPC_CHANNELS.TAGS_FIND_OR_CREATE),
    applyToNote: bridge(IPC_CHANNELS.TAGS_APPLY_TO_NOTE),
    removeFromNote: bridge(IPC_CHANNELS.TAGS_REMOVE_FROM_NOTE),
    getForNote: bridge(IPC_CHANNELS.TAGS_GET_FOR_NOTE),
    merge: bridge(IPC_CHANNELS.TAGS_MERGE),
    capturesWithAnyTag: bridge(IPC_CHANNELS.TAGS_CAPTURES_WITH_ANY_TAG)
  },
  persona: {
    list: bridge(IPC_CHANNELS.PERSONAS_LIST),
    create: bridge(IPC_CHANNELS.PERSONAS_CREATE),
    update: bridge(IPC_CHANNELS.PERSONAS_UPDATE),
    delete: bridge(IPC_CHANNELS.PERSONAS_DELETE),
    import: bridge(IPC_CHANNELS.PERSONAS_IMPORT),
    storageState: bridge(IPC_CHANNELS.PERSONAS_STORAGE_STATE)
  },
  selectors: {
    list: bridge(IPC_CHANNELS.SELECTORS_LIST),
    get: bridge(IPC_CHANNELS.SELECTORS_GET),
    create: bridge(IPC_CHANNELS.SELECTORS_CREATE),
    update: bridge(IPC_CHANNELS.SELECTORS_UPDATE),
    rescan: bridge(IPC_CHANNELS.SELECTORS_RESCAN),
    delete: bridge(IPC_CHANNELS.SELECTORS_DELETE),
    listActive: bridge(IPC_CHANNELS.SELECTORS_LIST_ACTIVE),
    matchCounts: bridge(IPC_CHANNELS.SELECTORS_MATCH_COUNTS),
    matchingCaptures: bridge(IPC_CHANNELS.SELECTORS_MATCHING_CAPTURES),
    coverage: bridge(IPC_CHANNELS.SELECTORS_COVERAGE),
    captureMatrix: bridge(IPC_CHANNELS.SELECTORS_CAPTURE_MATRIX),
    bulkCreate: bridge(IPC_CHANNELS.SELECTORS_BULK_CREATE),
    exportMatches: bridge(IPC_CHANNELS.SELECTORS_EXPORT_MATCHES)
  },
  notes: {
    list: bridge(IPC_CHANNELS.NOTES_LIST),
    get: bridge(IPC_CHANNELS.NOTES_GET),
    create: bridge(IPC_CHANNELS.NOTES_CREATE),
    update: bridge(IPC_CHANNELS.NOTES_UPDATE),
    delete: bridge(IPC_CHANNELS.NOTES_DELETE),
    count: bridge(IPC_CHANNELS.NOTES_COUNT),
    search: bridge(IPC_CHANNELS.NOTES_SEARCH),
    references: bridge(IPC_CHANNELS.NOTES_REFERENCES),
    backlinks: bridge(IPC_CHANNELS.NOTES_BACKLINKS),
    backlinkCounts: bridge(IPC_CHANNELS.NOTES_BACKLINK_COUNTS),
    referenceEdges: bridge(IPC_CHANNELS.NOTES_REFERENCE_EDGES)
  },
  wayback: {
    lookup: bridge(IPC_CHANNELS.WAYBACK_LOOKUP),
    lookupLink: bridge(IPC_CHANNELS.WAYBACK_LOOKUP_LINK),
    lookupLinks: bridge(IPC_CHANNELS.WAYBACK_LOOKUP_LINKS),
    cancelLookupLinks: bridge(IPC_CHANNELS.WAYBACK_CANCEL_LOOKUP_LINKS),
    list: bridge(IPC_CHANNELS.WAYBACK_LIST),
    listForCase: bridge(IPC_CHANNELS.WAYBACK_LIST_FOR_CASE),
    pin: bridge(IPC_CHANNELS.WAYBACK_PIN),
    unpin: bridge(IPC_CHANNELS.WAYBACK_UNPIN)
  },
  annotations: {
    get: bridge(IPC_CHANNELS.ANNOTATIONS_GET),
    save: bridge(IPC_CHANNELS.ANNOTATIONS_SAVE),
    delete: bridge(IPC_CHANNELS.ANNOTATIONS_DELETE),
    upsertPin: bridge(IPC_CHANNELS.ANNOTATIONS_UPSERT_PIN),
    deletePin: bridge(IPC_CHANNELS.ANNOTATIONS_DELETE_PIN)
  },

  extension: {
    getPath: bridge(IPC_CHANNELS.EXTENSION_PATH),
    openFolder: bridge(IPC_CHANNELS.EXTENSION_OPEN_FOLDER)
  },

  session: {
    snapshot: bridge(IPC_CHANNELS.SESSION_SNAPSHOT),
    activateCase: bridge(IPC_CHANNELS.SESSION_ACTIVATE_CASE),
    start: bridge(IPC_CHANNELS.SESSION_START),
    stop: bridge(IPC_CHANNELS.SESSION_STOP)
  },

  search: bridge(IPC_CHANNELS.SEARCH),

  settings: {
    get: bridge(IPC_CHANNELS.SETTINGS_GET),
    update: bridge(IPC_CHANNELS.SETTINGS_UPDATE),
    reset: bridge(IPC_CHANNELS.SETTINGS_RESET),
    getIdentity: bridge(IPC_CHANNELS.SETTINGS_GET_IDENTITY),
    chooseStoragePath: bridge(IPC_CHANNELS.SETTINGS_CHOOSE_STORAGE_PATH)
  },

  export: {
    preflight: bridge(IPC_CHANNELS.EXPORT_PREFLIGHT),
    generateReport: bridge(IPC_CHANNELS.EXPORT_GENERATE)
  },

  shell: {
    showItemInFolder: bridge(IPC_CHANNELS.SHELL_SHOW_ITEM_IN_FOLDER),
    openPath: bridge(IPC_CHANNELS.SHELL_OPEN_PATH)
  },

  exhibits: {
    inventory: bridge(IPC_CHANNELS.EXHIBITS_INVENTORY),
    verify: bridge(IPC_CHANNELS.EXHIBITS_VERIFY)
  },

  manifest: {
    snapshot: bridge(IPC_CHANNELS.MANIFEST_SNAPSHOT)
  },

  sharing: {
    getSyncState: refusable(IPC_CHANNELS.SHARING_GET_SYNC_STATE),
    createInvite: refusable(IPC_CHANNELS.SHARING_CREATE_INVITE),
    cancelInvite: refusable(IPC_CHANNELS.SHARING_CANCEL_INVITE),
    readInvite: refusable(IPC_CHANNELS.SHARING_READ_INVITE),
    join: refusable(IPC_CHANNELS.SHARING_JOIN),
    approveJoin: refusable(IPC_CHANNELS.SHARING_APPROVE_JOIN),
    declineJoin: refusable(IPC_CHANNELS.SHARING_DECLINE_JOIN),
    revoke: refusable(IPC_CHANNELS.SHARING_REVOKE),
    excludeExhibit: refusable(IPC_CHANNELS.SHARING_EXCLUDE_EXHIBIT),
    syncNow: refusable(IPC_CHANNELS.SHARING_SYNC_NOW),
    getMembers: refusable(IPC_CHANNELS.SHARING_GET_MEMBERS),
    isAvailable: refusable(IPC_CHANNELS.SHARING_IS_AVAILABLE),
    setRelayUrl: refusable(IPC_CHANNELS.SHARING_SET_RELAY_URL)
  },

  investigation: {
    getRevision: bridge(IPC_CHANNELS.INVESTIGATION_GET_REVISION),
    getView: bridge(IPC_CHANNELS.INVESTIGATION_GET_VIEW),
    getSpan: bridge(IPC_CHANNELS.INVESTIGATION_GET_SPAN),
    checkSpan: bridge(IPC_CHANNELS.INVESTIGATION_CHECK_SPAN),
    startRun: bridge(IPC_CHANNELS.INVESTIGATION_START_RUN),
    cancelRun: bridge(IPC_CHANNELS.INVESTIGATION_CANCEL_RUN),
    getChanges: bridge(IPC_CHANNELS.INVESTIGATION_GET_CHANGES),
    decideJoint: bridge(IPC_CHANNELS.INVESTIGATION_DECIDE_JOINT),
    decideSpan: bridge(IPC_CHANNELS.INVESTIGATION_DECIDE_SPAN),
    chooseSubject: bridge(IPC_CHANNELS.INVESTIGATION_CHOOSE_SUBJECT),
    addSubject: bridge(IPC_CHANNELS.INVESTIGATION_ADD_SUBJECT),
    keepSubject: bridge(IPC_CHANNELS.INVESTIGATION_KEEP_SUBJECT),
    setSourceClass: bridge(IPC_CHANNELS.INVESTIGATION_SET_SOURCE_CLASS),
    setCopyMark: bridge(IPC_CHANNELS.INVESTIGATION_SET_COPY_MARK),
    setWithheld: bridge(IPC_CHANNELS.INVESTIGATION_SET_WITHHELD),
    listOwnIdentifiers: bridge(IPC_CHANNELS.INVESTIGATION_LIST_OWN_IDENTIFIERS),
    markOwnIdentifier: bridge(IPC_CHANNELS.INVESTIGATION_MARK_OWN_IDENTIFIER),
    unmarkOwnIdentifier: bridge(IPC_CHANNELS.INVESTIGATION_UNMARK_OWN_IDENTIFIER)
  },

  staging: {
    upload: bridge(IPC_CHANNELS.STAGING_UPLOAD),
    commit: bridge(IPC_CHANNELS.STAGING_COMMIT),
    discard: bridge(IPC_CHANNELS.STAGING_DISCARD)
  },

  app: {
    getVersion: bridge(IPC_CHANNELS.APP_GET_VERSION)
  },

  diagnostics: {
    get: bridge(IPC_CHANNELS.DIAGNOSTICS_GET),
    log: bridge(IPC_CHANNELS.DIAGNOSTICS_LOG),
    recentEntries: bridge(IPC_CHANNELS.DIAGNOSTICS_RECENT),
    revealLog: bridge(IPC_CHANNELS.DIAGNOSTICS_REVEAL_LOG),
    exportLogs: bridge(IPC_CHANNELS.DIAGNOSTICS_EXPORT_LOGS),
    openStorageRoot: bridge(IPC_CHANNELS.DIAGNOSTICS_OPEN_STORAGE_ROOT),
    lastSession: bridge(IPC_CHANNELS.DIAGNOSTICS_LAST_SESSION),
    createReport: bridge(IPC_CHANNELS.DIAGNOSTICS_CREATE_REPORT),
    unreconciledDeletions: bridge(IPC_CHANNELS.DIAGNOSTICS_UNRECONCILED_DELETIONS)
  },

  updates: {
    getStatus: bridge(IPC_CHANNELS.UPDATES_GET_STATUS),
    check: bridge(IPC_CHANNELS.UPDATES_CHECK),
    download: bridge(IPC_CHANNELS.UPDATES_DOWNLOAD),
    install: bridge(IPC_CHANNELS.UPDATES_INSTALL)
  },

  db: {
    stats: bridge(IPC_CHANNELS.DB_STATS),
    tableRows: bridge(IPC_CHANNELS.DB_TABLE_ROWS),
    createRow: bridge(IPC_CHANNELS.DB_CREATE_ROW),
    updateRow: bridge(IPC_CHANNELS.DB_UPDATE_ROW),
    deleteRow: bridge(IPC_CHANNELS.DB_DELETE_ROW),
    vacuum: bridge(IPC_CHANNELS.DB_VACUUM),
    rebuildFts: bridge(IPC_CHANNELS.DB_REBUILD_FTS),
    integrityCheck: bridge(IPC_CHANNELS.DB_INTEGRITY_CHECK),
    purgeArchived: bridge(IPC_CHANNELS.DB_PURGE_ARCHIVED),
    findOrphans: bridge(IPC_CHANNELS.DB_FIND_ORPHANS),
    cleanOrphans: bridge(IPC_CHANNELS.DB_CLEAN_ORPHANS),
    backup: bridge(IPC_CHANNELS.DB_BACKUP),
    restore: bridge(IPC_CHANNELS.DB_RESTORE),
    snapshots: bridge(IPC_CHANNELS.DB_SNAPSHOTS),
    restoreSnapshot: bridge(IPC_CHANNELS.DB_RESTORE_SNAPSHOT),
    exportTable: bridge(IPC_CHANNELS.DB_EXPORT_TABLE)
  },

  // Event listeners (main -> renderer)
  onExportProgress: subscribe(IPC_CHANNELS.EXPORT_PROGRESS),

  onArchiveProgress: subscribe(IPC_CHANNELS.ARCHIVE_PROGRESS),

  onNewCapture: subscribe(IPC_CHANNELS.NEW_CAPTURE),

  onSessionStateChanged: subscribe(IPC_CHANNELS.SESSION_STATE_CHANGED),

  onExtensionConnection: subscribe(IPC_CHANNELS.EXTENSION_CONNECTION),

  onExtensionAttach: subscribe(IPC_CHANNELS.EXTENSION_ATTACH),

  onCaptureActivity: subscribe(IPC_CHANNELS.CAPTURE_ACTIVITY),

  onLogEntry: subscribe(IPC_CHANNELS.LOG_ENTRY),

  onSelectorRematched: subscribe(IPC_CHANNELS.SELECTOR_REMATCHED),

  onDeepLinkNavigate: subscribe(IPC_CHANNELS.DEEP_LINK_NAVIGATE),

  onUpdateStatus: subscribe(IPC_CHANNELS.UPDATE_STATUS),

  onGuestFrameReplaced: subscribe(IPC_CHANNELS.GUEST_FRAME_REPLACED),

  onGuestMouseDown: subscribe(IPC_CHANNELS.GUEST_MOUSE_DOWN),

  onSharingChanged: subscribe(IPC_CHANNELS.SHARING_CHANGED),

  onSharingJoinProgress: subscribe(IPC_CHANNELS.SHARING_JOIN_PROGRESS),

  onInvestigationProgress: subscribe(IPC_CHANNELS.INVESTIGATION_PROGRESS),

  onWaybackLinkProgress: subscribe(IPC_CHANNELS.WAYBACK_LINK_PROGRESS),

  testPipeline: bridge(IPC_CHANNELS.CAPTURES_TEST_PIPELINE),

  testHttp: bridge(IPC_CHANNELS.CAPTURES_TEST_HTTP),

  extractedData: {
    categories: bridge(IPC_CHANNELS.EXTRACTED_DATA_CATEGORIES),
    subcategories: bridge(IPC_CHANNELS.EXTRACTED_DATA_SUBCATEGORIES),
    items: bridge(IPC_CHANNELS.EXTRACTED_DATA_ITEMS),
    count: bridge(IPC_CHANNELS.EXTRACTED_DATA_COUNT),
    search: bridge(IPC_CHANNELS.EXTRACTED_DATA_SEARCH),
    reprocess: bridge(IPC_CHANNELS.EXTRACTED_DATA_REPROCESS)
  }
} satisfies BirdbrainAPI

contextBridge.exposeInMainWorld('birdbrain', birdbrain)
