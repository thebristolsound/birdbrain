import { ipcMain, dialog, shell } from 'electron'
import { IPC_CHANNELS } from '@shared/ipc'
import type {
  CreateCaseParams,
  UpdateCaseParams,
  CreateTagParams,
  UpdateTagParams,
  CaptureTagParams,
  CreateSelectorParams,
  UpdateSelectorParams,
  CreateNoteParams,
  UpdateNoteParams,
  BulkCreateSelectorsParams
} from '@shared/ipc'
import * as db from '@main/services/database'
import * as storage from '@main/services/storage'
import * as settings from '@main/services/settings'
import * as openrouter from '@main/services/openrouter'
import { generateReport } from '@main/services/export'
import { buildCsv } from '@main/services/csvEscape'
import { CAPTURE_SERVER_PORT, getSessionState } from '@main/services/captureServer'
import type { BirdbrainSettings, ExportOptions } from '@shared/types'

type IpcResult<T = unknown> =
  | {
      ok: true
      data: T
    }
  | {
      ok: false
      error: string
      code?: string
    }

function ipcResult<T>(data: T): IpcResult<T> {
  return { ok: true, data }
}

function ipcError(err: unknown): IpcResult<never> {
  const sqliteErr = err as { code?: string; message?: string }
  if (sqliteErr.code === 'SQLITE_CONSTRAINT_UNIQUE') {
    return { ok: false, error: 'A record with that value already exists', code: sqliteErr.code }
  }
  if (sqliteErr.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') {
    return { ok: false, error: 'Referenced record does not exist', code: sqliteErr.code }
  }
  if (sqliteErr.code === 'SQLITE_BUSY') {
    return { ok: false, error: 'Database is busy, please try again', code: sqliteErr.code }
  }
  if (typeof sqliteErr.code === 'string' && sqliteErr.code.startsWith('SQLITE_')) {
    return { ok: false, error: sqliteErr.message ?? 'Database error', code: sqliteErr.code }
  }
  throw err
}

export function registerIpcHandlers(): void {
  // Cases
  ipcMain.handle(IPC_CHANNELS.CASES_LIST, () => db.listCases())
  ipcMain.handle(IPC_CHANNELS.CASES_GET, (_, id: string) => db.getCase(id))
  ipcMain.handle(IPC_CHANNELS.CASES_CREATE, (_, params: CreateCaseParams) => {
    try {
      return ipcResult(db.createCase(params))
    } catch (err) {
      return ipcError(err)
    }
  })
  ipcMain.handle(IPC_CHANNELS.CASES_UPDATE, (_, params: UpdateCaseParams) => {
    try {
      return ipcResult(db.updateCase(params))
    } catch (err) {
      return ipcError(err)
    }
  })
  ipcMain.handle(IPC_CHANNELS.CASES_DELETE, (_, id: string) => {
    try {
      return ipcResult(db.deleteCase(id))
    } catch (err) {
      return ipcError(err)
    }
  })

  // Captures
  ipcMain.handle(IPC_CHANNELS.CAPTURES_LIST, (_, caseId: string) => db.listCaptures(caseId))
  ipcMain.handle(IPC_CHANNELS.CAPTURES_GET, (_, id: string) => db.getCapture(id))
  ipcMain.handle(IPC_CHANNELS.CAPTURES_DELETE, (_, id: string) => {
    try {
      const capture = db.getCapture(id)
      if (!capture) return ipcResult(false)
      const deleted = db.deleteCapture(id)
      if (deleted) {
        storage.deleteCaptureFiles(capture.caseId, id)
      }
      return ipcResult(deleted)
    } catch (err) {
      return ipcError(err)
    }
  })

  ipcMain.handle(IPC_CHANNELS.CAPTURES_COUNTS_BY_CASE, () => {
    try {
      return ipcResult(db.getCaptureCountsByCase())
    } catch (err) {
      return ipcError(err)
    }
  })

  ipcMain.handle(IPC_CHANNELS.CAPTURES_DOWNLOAD, async (_, captureId: string) => {
    try {
      const capture = db.getCapture(captureId)
      if (!capture) return ipcResult(null)
      const { canceled, filePath } = await dialog.showSaveDialog({
        defaultPath: `${capture.title || 'capture'}.html`,
        filters: [{ name: 'HTML', extensions: ['html'] }]
      })
      if (canceled || !filePath) return ipcResult(null)
      const buffer = storage.readCaptureFile(capture.caseId, captureId, 'html')
      if (!buffer) return { ok: false, error: 'HTML file not found' }
      const { writeFileSync } = await import('fs')
      writeFileSync(filePath, buffer)
      return ipcResult(filePath)
    } catch (err) {
      return ipcError(err)
    }
  })

  ipcMain.handle(IPC_CHANNELS.CAPTURES_OPEN_EXTERNAL, async (_, url: string) => {
    try {
      let parsed: URL
      try {
        parsed = new URL(url)
      } catch {
        return {
          ok: false,
          error: 'Invalid URL',
          code: 'INVALID_URL'
        } as IpcResult
      }

      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return {
          ok: false,
          error: 'URL protocol not allowed',
          code: 'INVALID_URL_PROTOCOL'
        } as IpcResult
      }

      await shell.openExternal(url)
      return ipcResult(undefined)
    } catch (err) {
      return ipcError(err)
    }
  })

  // Capture pipeline test
  ipcMain.handle(IPC_CHANNELS.CAPTURES_TEST_PIPELINE, async () => {
    try {
      const res = await fetch(`http://127.0.0.1:${CAPTURE_SERVER_PORT}/api/captures/test`)
      return res.json()
    } catch (err) {
      return { success: false, durationMs: 0, error: String(err) }
    }
  })

  // HTTP test (verifies Hono server is reachable)
  ipcMain.handle(IPC_CHANNELS.CAPTURES_TEST_HTTP, async () => {
    const start = Date.now()
    try {
      const res = await fetch(`http://127.0.0.1:${CAPTURE_SERVER_PORT}/api/status`)
      const ok = res.ok
      return {
        success: ok,
        durationMs: Date.now() - start,
        error: ok ? undefined : `HTTP ${res.status}`
      }
    } catch (err) {
      return { success: false, durationMs: Date.now() - start, error: String(err) }
    }
  })

  // Tags
  ipcMain.handle(IPC_CHANNELS.TAGS_LIST, () => db.listTags())
  ipcMain.handle(IPC_CHANNELS.TAGS_CREATE, (_, params: CreateTagParams) => {
    try {
      return ipcResult(db.createTag(params))
    } catch (err) {
      return ipcError(err)
    }
  })
  ipcMain.handle(IPC_CHANNELS.TAGS_UPDATE, (_, params: UpdateTagParams) => {
    try {
      return ipcResult(db.updateTag(params))
    } catch (err) {
      return ipcError(err)
    }
  })
  ipcMain.handle(IPC_CHANNELS.TAGS_DELETE, (_, id: string) => {
    try {
      return ipcResult(db.deleteTag(id))
    } catch (err) {
      return ipcError(err)
    }
  })
  ipcMain.handle(IPC_CHANNELS.TAGS_ADD_TO_CAPTURE, (_, params: CaptureTagParams) => {
    try {
      db.addTagToCapture(params)
      return ipcResult(undefined)
    } catch (err) {
      return ipcError(err)
    }
  })
  ipcMain.handle(IPC_CHANNELS.TAGS_REMOVE_FROM_CAPTURE, (_, params: CaptureTagParams) => {
    try {
      db.removeTagFromCapture(params)
      return ipcResult(undefined)
    } catch (err) {
      return ipcError(err)
    }
  })
  ipcMain.handle(IPC_CHANNELS.TAGS_GET_FOR_CAPTURE, (_, captureId: string) =>
    db.getTagsForCapture(captureId)
  )
  ipcMain.handle(IPC_CHANNELS.TAGS_COUNT_FOR_CASE, (_, caseId: string) =>
    db.getTagCountForCase(caseId)
  )
  ipcMain.handle(IPC_CHANNELS.TAGS_USAGE_COUNTS_FOR_CASE, (_, caseId: string) =>
    db.getTagUsageCountsForCase(caseId)
  )

  // Selectors
  ipcMain.handle(IPC_CHANNELS.SELECTORS_LIST, (_, caseId: string) => db.listSelectors(caseId))
  ipcMain.handle(IPC_CHANNELS.SELECTORS_GET, (_, id: string) => db.getSelector(id))
  ipcMain.handle(IPC_CHANNELS.SELECTORS_CREATE, (_, params: CreateSelectorParams) => {
    try {
      const selector = db.createSelector(params)
      // Retroactively match against existing captures
      const captures = db.listCaptures(params.caseId)
      const captureTexts: Array<{ captureId: string; text: string }> = []
      for (const cap of captures) {
        const buffer = storage.readCaptureFile(params.caseId, cap.id, 'txt')
        if (buffer) {
          captureTexts.push({ captureId: cap.id, text: buffer.toString('utf-8') })
        }
      }
      if (captureTexts.length > 0) {
        db.matchSelectorAgainstCaptures(selector.id, captureTexts)
      }
      return ipcResult(selector)
    } catch (err) {
      return ipcError(err)
    }
  })
  ipcMain.handle(IPC_CHANNELS.SELECTORS_BULK_CREATE, (_, params: BulkCreateSelectorsParams) => {
    try {
      const created = db.bulkCreateSelectors(
        params.selectors.map((s) => ({
          caseId: params.caseId,
          pattern: s.pattern,
          isRegex: s.isRegex,
          label: s.label
        }))
      )
      // Load capture texts once and reuse across all new selectors (O(N+M) not O(N*M)).
      if (created.length > 0) {
        const captures = db.listCaptures(params.caseId)
        const captureTexts: Array<{ captureId: string; text: string }> = []
        for (const cap of captures) {
          const buffer = storage.readCaptureFile(params.caseId, cap.id, 'txt')
          if (buffer) {
            captureTexts.push({ captureId: cap.id, text: buffer.toString('utf-8') })
          }
        }
        if (captureTexts.length > 0) {
          for (const sel of created) {
            db.matchSelectorAgainstCaptures(sel.id, captureTexts)
          }
        }
      }
      return ipcResult(created)
    } catch (err) {
      return ipcError(err)
    }
  })
  ipcMain.handle(IPC_CHANNELS.SELECTORS_UPDATE, (_, params: UpdateSelectorParams) => {
    try {
      return ipcResult(db.updateSelector(params))
    } catch (err) {
      return ipcError(err)
    }
  })
  ipcMain.handle(IPC_CHANNELS.SELECTORS_DELETE, (_, id: string) => {
    try {
      return ipcResult(db.deleteSelector(id))
    } catch (err) {
      return ipcError(err)
    }
  })
  ipcMain.handle(IPC_CHANNELS.SELECTORS_LIST_ACTIVE, () => {
    const { activeCaseId } = getSessionState()
    return db.listActiveSelectors(activeCaseId ?? undefined)
  })
  ipcMain.handle(IPC_CHANNELS.SELECTORS_MATCH_COUNTS, (_, caseId: string) =>
    db.getSelectorMatchCounts(caseId)
  )
  ipcMain.handle(
    IPC_CHANNELS.SELECTORS_MATCHING_CAPTURES,
    (_, caseId: string, selectorIds: string[]) =>
      db.getCapturesMatchingSelectors(caseId, selectorIds)
  )
  ipcMain.handle(IPC_CHANNELS.SELECTORS_COVERAGE, (_, caseId: string) =>
    db.getSelectorCoverage(caseId)
  )
  ipcMain.handle(IPC_CHANNELS.SELECTORS_EXPORT_MATCHES, async (_, caseId: string) => {
    try {
      const caseRow = db.getCase(caseId)
      if (!caseRow) return ipcResult({ exported: false })
      const rows = db.getSelectorMatchesForExport(caseId)
      const csv = buildCsv(
        [
          'Selector Pattern',
          'Selector Label',
          'Type',
          'Capture URL',
          'Capture Title',
          'Capture Timestamp'
        ],
        rows.map((r) => [
          r.selectorPattern,
          r.selectorLabel ?? '',
          r.isRegex ? 'regex' : 'text',
          r.captureUrl,
          r.captureTitle ?? '',
          r.captureTimestamp
        ])
      )
      const safeName = caseRow.name.replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 80) || 'case'
      const { canceled, filePath } = await dialog.showSaveDialog({
        defaultPath: `${safeName}_selector_matches.csv`,
        filters: [{ name: 'CSV', extensions: ['csv'] }]
      })
      if (canceled || !filePath) return ipcResult({ exported: false })
      const { writeFileSync } = await import('fs')
      writeFileSync(filePath, csv, 'utf-8')
      return ipcResult({ exported: true, path: filePath })
    } catch (err) {
      return ipcError(err)
    }
  })

  // Notes
  ipcMain.handle(IPC_CHANNELS.NOTES_LIST, (_, caseId: string) => db.listNotes(caseId))
  ipcMain.handle(IPC_CHANNELS.NOTES_GET, (_, id: string) => db.getNote(id))
  ipcMain.handle(IPC_CHANNELS.NOTES_CREATE, (_, params: CreateNoteParams) => {
    try {
      return ipcResult(db.createNote(params))
    } catch (err) {
      return ipcError(err)
    }
  })
  ipcMain.handle(IPC_CHANNELS.NOTES_UPDATE, (_, params: UpdateNoteParams) => {
    try {
      return ipcResult(db.updateNote(params))
    } catch (err) {
      return ipcError(err)
    }
  })
  ipcMain.handle(IPC_CHANNELS.NOTES_DELETE, (_, id: string) => {
    try {
      return ipcResult(db.deleteNote(id))
    } catch (err) {
      return ipcError(err)
    }
  })
  ipcMain.handle(IPC_CHANNELS.NOTES_COUNT, (_, caseId: string) => db.getNoteCount(caseId))
  ipcMain.handle(IPC_CHANNELS.NOTES_SEARCH, (_, caseId: string, query: string) => {
    try {
      return db.searchNotes(caseId, query)
    } catch {
      // FTS5 can throw on malformed queries (e.g. unmatched quotes, reserved keywords).
      // Return empty results so the UI gracefully handles bad input.
      return []
    }
  })

  // Captures - get content
  ipcMain.handle(
    IPC_CHANNELS.CAPTURES_GET_CONTENT,
    (_, captureId: string, type: 'html' | 'png' | 'txt') => {
      const capture = db.getCapture(captureId)
      if (!capture) return null
      const buffer = storage.readCaptureFile(capture.caseId, captureId, type)
      if (!buffer) return null
      if (type === 'png') return buffer.toString('base64')
      return buffer.toString('utf-8')
    }
  )

  // Captures - get thumbnail
  ipcMain.handle(IPC_CHANNELS.CAPTURES_GET_THUMBNAIL, (_, captureId: string) => {
    try {
      const capture = db.getCapture(captureId)
      if (!capture) return null
      const buffer = storage.getThumbnail(capture.caseId, captureId)
      if (!buffer) return null
      return buffer.toString('base64')
    } catch (err) {
      console.error('Error getting thumbnail:', err)
      return null
    }
  })

  // Captures - get matching selectors
  ipcMain.handle(IPC_CHANNELS.CAPTURES_GET_MATCHING_SELECTORS, (_, captureId: string) => {
    return db.getCaptureMatchingSelectors(captureId)
  })

  // Captures - favorites
  ipcMain.handle(IPC_CHANNELS.CAPTURES_TOGGLE_FAVORITE, (_, captureId: string) => {
    try {
      return ipcResult(db.toggleFavorite(captureId))
    } catch (err) {
      return ipcError(err)
    }
  })

  ipcMain.handle(IPC_CHANNELS.CAPTURES_IS_FAVORITE, (_, captureId: string) => {
    try {
      return ipcResult(db.isFavorite(captureId))
    } catch (err) {
      return ipcError(err)
    }
  })

  ipcMain.handle(IPC_CHANNELS.CAPTURES_LIST_FAVORITES, (_, caseId: string) => {
    try {
      return ipcResult(db.listFavorites(caseId))
    } catch (err) {
      return ipcError(err)
    }
  })

  ipcMain.handle(IPC_CHANNELS.CAPTURES_VERIFY, async (_, captureId: string) => {
    try {
      const mod = await import('@main/services/mhtmlIngest')
      return ipcResult(await mod.verifyCapture(captureId))
    } catch (err) {
      return ipcError(err)
    }
  })

  // Search
  ipcMain.handle(IPC_CHANNELS.SEARCH, (_, query: string) => db.searchCaptures(query))

  // Settings
  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET, () => settings.getSettings())
  ipcMain.handle(IPC_CHANNELS.SETTINGS_UPDATE, (_, partial: Partial<BirdbrainSettings>) =>
    settings.updateSettings(partial)
  )
  ipcMain.handle(IPC_CHANNELS.SETTINGS_RESET, () => settings.resetSettings())
  ipcMain.handle(IPC_CHANNELS.SETTINGS_TEST_OPENROUTER, (_, apiKey: string) =>
    openrouter.testApiKey(apiKey)
  )
  ipcMain.handle(IPC_CHANNELS.SETTINGS_LIST_MODELS, (_, apiKey: string) =>
    openrouter.listModels(apiKey)
  )

  // Export
  ipcMain.handle(
    IPC_CHANNELS.EXPORT_GENERATE,
    async (_, caseId: string, options: ExportOptions) => {
      try {
        await generateReport(caseId, options)
        return ipcResult(undefined)
      } catch (err) {
        return ipcError(err)
      }
    }
  )
}
