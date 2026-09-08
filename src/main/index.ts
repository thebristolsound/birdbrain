// `session` is aliased because the whenReady block below binds a local `session` to
// the sessionLog record, which would shadow it there.
import { app, BrowserWindow, dialog, shell, session as electronSession } from 'electron'
import { join, resolve } from 'path'
import { is } from '@electron-toolkit/utils'
import { initDatabase, closeDatabase } from '@main/services/db/core'
import { PreMigrationSnapshotError } from '@main/services/db/dbSnapshots'
import { initStorage } from '@main/services/storage'
import { seedDemoCaseIfNeeded } from '@main/services/demoCase'
import {
  startCaptureServer,
  stopCaptureServer,
  setMainWindow,
  startExtensionConnectionCheck,
  stopExtensionConnectionCheck
} from '@main/services/captureServer'
import { registerIpcHandlers } from '@main/ipcHandlers'
import { resolveWindowSize, MIN_WINDOW_SIZE } from '@main/windowSize'
import { revealWhenReady } from '@main/windowReveal'
import {
  allowWebviewPermission,
  decideWebviewAttach,
  decideWebviewDownload,
  decideWebviewNavigation,
  decideWebviewRequest,
  resolveAttachPartition,
  sanitizeWebviewPreferences,
  WEBVIEW_PARTITIONS
} from '@main/webviewPolicy'
import { initSettings, getSettings } from '@main/services/settings'
import { initInstallationId, getInstallationId } from '@main/services/installationId'
import { initSigningKey, SigningKeyUnacknowledgedError } from '@main/services/signingKey'
import { initServerToken } from '@main/services/serverToken'
import { createCaptureLifecycle } from '@main/services/captureLifecycle'
import { createTimestampWorker } from '@main/services/timestampWorker'
import { runExhibitBackfill } from '@main/services/exhibitBackfill'
import { createSelectorLifecycle } from '@main/services/selectorLifecycle'
import { createRecaptureService } from '@main/services/recapture'
import { createSessionService } from '@main/services/session'
import { createUpdaterService, type UpdaterService } from '@main/services/updater'
import { renderPageInHiddenWindow } from '@main/services/backgroundRenderer'
import { DEEP_LINK_SCHEME, parseDeepLink, findDeepLinkInArgv } from '@main/services/deepLink'
import {
  flushSync,
  initLogger,
  logger,
  disposeLogger,
  setMainWindow as setLoggerWindow
} from '@main/services/logger'
import { ident, tag } from '@main/services/logSafe'
import { detectInstallFormat } from '@main/services/diagnostics'
import { markCleanExit, startSession } from '@main/services/sessionLog'
import { IPC_CHANNELS, type DeepLinkTarget, type SelectorRematchedEvent } from '@shared/ipc'
import { sendEvent } from '@main/ipcWrap'

let mainWindow: BrowserWindow | null = null
// Deep link received before the renderer was ready (cold start); flushed once
// the window finishes loading.
let pendingNavigate: DeepLinkTarget | null = null
// Update-delivery service; disposed on quit.
let updaterService: UpdaterService | null = null

// Registered before whenReady so a failure during startup is still captured.
// logger.* is a no-op until initLogger runs, which is safe by construction.
process.on('uncaughtException', (err) => {
  logger.error('app', 'app.uncaught_exception', undefined, err)
  flushSync()
  dialog.showErrorBox(
    'Birdbrain encountered a fatal error',
    'The app must close. A diagnostic log has been saved — you can attach it to a bug report from Settings → Diagnostics after restarting.'
  )
  // app.exit, NOT app.quit — and this is load-bearing, not a style choice.
  // app.quit() emits 'before-quit', which calls markCleanExit() and deletes
  // session.lock. A fatal crash would then look identical to a normal quit on
  // the next launch and the recovery prompt would never appear. app.exit()
  // skips the lifecycle events, leaving the lock in place, which is exactly
  // the signal the next launch needs.
  app.exit(1)
})

process.on('unhandledRejection', (reason) => {
  logger.error('app', 'app.unhandled_rejection', undefined, reason)
  flushSync()
})

app.on('render-process-gone', (_event, contents, details) => {
  // 'clean-exit' and 'killed' are ordinary shutdown paths. Classify BEFORE
  // logging, not after: Task 12b toasts every main-process error, so logging
  // these at error level would tell a tester "The window stopped responding"
  // during a normal quit. They are still recorded, at info, because knowing
  // the renderer went away is useful context around a nearby failure.
  const ordinary = details.reason === 'clean-exit' || details.reason === 'killed'
  const level = ordinary ? 'info' : 'error'
  logger[level]('app', 'app.render_process_gone', {
    reason: tag(details.reason, 'renderGoneReason'),
    exitCode: details.exitCode
  })
  flushSync()

  // Logging alone leaves the tester staring at a dead window until they
  // restart the app by hand.
  if (ordinary) return

  const win = BrowserWindow.fromWebContents(contents)
  if (!win || win.isDestroyed()) return

  // Only the visible main window gets a recovery dialog. renderPageInHiddenWindow
  // creates a `show: false` offscreen window per background recapture, and a
  // hostile or memory-heavy captured page crashing that renderer is a recapture
  // failure, not an application crash: the dialog would be parented to a window
  // the tester cannot see, and 'Reload' would reload the capture rather than the
  // UI. The recapture lifecycle owns those failures. The entry is still logged
  // above either way.
  if (win !== mainWindow) return

  const { response } = dialog.showMessageBoxSync
    ? {
        response: dialog.showMessageBoxSync(win, {
          type: 'error',
          buttons: ['Reload', 'Ignore'],
          defaultId: 0,
          title: 'Birdbrain stopped responding',
          message: 'The window crashed. Reloading recovers it — your captures are unaffected.'
        })
      }
    : { response: 1 }

  if (response === 0) win.reload()
})

app.on('child-process-gone', (_event, details) => {
  // Same ordinary-exit classification as render-process-gone above, and for
  // the same reason: both events draw from PROCESS_GONE_REASONS, and
  // mainLogBridge turns every main-process error into a toast carrying a
  // 'Report this' action. A GPU or utility helper shutting down cleanly during
  // a normal quit would otherwise be presented to the tester as a failure
  // worth reporting. Still recorded at info — knowing a helper went away is
  // useful context around a nearby real failure.
  const ordinary = details.reason === 'clean-exit' || details.reason === 'killed'
  const level = ordinary ? 'info' : 'error'
  // tag(), NOT ident(): Electron's child-process type labels contain spaces
  // ('Pepper Plugin', 'Sandbox helper'), which ident() rejects — and a
  // rejection throws outside production, escalating a child-process failure
  // into a fatal main-process exception from inside the crash handler itself.
  logger[level]('app', 'app.child_process_gone', {
    processType: tag(details.type, 'childProcessType'),
    reason: tag(details.reason, 'childGoneReason'),
    exitCode: details.exitCode
  })
  flushSync()
})

// Once per process, not once per window. `fromPartition` returns the same
// long-lived Session for a given name, and `will-download` is an emitter
// subscription rather than a setter — so a second createWindow() (the macOS
// `activate` path) would stack a duplicate listener on a Session that is
// already hardened.
let webviewSessionsHardened = false

// Denies permissions, downloads and off-allow-list requests on every partition a
// webview may run on. Runs before the window exists, so no guest can attach ahead
// of its own session's handlers. Both permission handlers are set: a request
// handler alone leaves the synchronous check path (which Chromium consults for
// already-granted permissions) at its default.
function hardenWebviewSessions(): void {
  if (webviewSessionsHardened) return
  webviewSessionsHardened = true
  for (const partition of WEBVIEW_PARTITIONS) {
    const guestSession = electronSession.fromPartition(partition)
    guestSession.setPermissionRequestHandler((_contents, permission, callback) => {
      callback(allowWebviewPermission(partition, permission))
    })
    guestSession.setPermissionCheckHandler((_contents, permission) =>
      allowWebviewPermission(partition, permission)
    )
    // Through the policy rather than an inline preventDefault: the decision is
    // the module's to make, and a hardcoded call here would leave the download
    // known-answer test answering about a function the app never runs.
    guestSession.on('will-download', (event) => {
      if (decideWebviewDownload() === 'block') event.preventDefault()
    })
    // Every request the guest issues, not only the navigations `will-navigate`
    // sees (#886, #810). No filter argument, so subresources are in scope: that
    // is the whole gap, since an <img>, a font or a fetch from script raises no
    // navigation event. Denials are deliberately not logged — one replay page
    // can issue hundreds and the fact worth keeping is the allow-list, which is
    // written down in webviewPolicy.ts rather than inferred from a log.
    guestSession.webRequest.onBeforeRequest((details, callback) => {
      callback({ cancel: decideWebviewRequest({ partition, url: details.url }) === 'block' })
    })
  }
}

// Which of our partitions this guest is running on, identified by its Session —
// `fromPartition` returns the same instance for the same name, so this is an
// identity test rather than a string the guest could have influenced after attach.
function webviewPartitionOf(contents: Electron.WebContents): string | null {
  for (const partition of WEBVIEW_PARTITIONS) {
    if (contents.session === electronSession.fromPartition(partition)) return partition
  }
  return null
}

function createWindow(): BrowserWindow {
  hardenWebviewSessions()
  const { width, height } = resolveWindowSize(process.env.BIRDBRAIN_WINDOW_SIZE, !app.isPackaged)
  const win = new BrowserWindow({
    width,
    height,
    minWidth: MIN_WINDOW_SIZE.width,
    minHeight: MIN_WINDOW_SIZE.height,
    show: false,
    title: 'Birdbrain',
    backgroundColor: '#000000',
    ...(process.platform === 'linux' || process.platform === 'win32'
      ? { icon: join(__dirname, '../../resources/icon.png') }
      : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true
    }
  })

  mainWindow = win

  // Not a bare ready-to-show handler: that event can never fire under Wayland on
  // Electron 38+, which strands the window hidden forever (#643).
  revealWhenReady(win)

  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })

  // Flush a deep link that arrived before the renderer was listening (cold start).
  win.webContents.on('did-finish-load', () => {
    if (pendingNavigate) {
      sendEvent(win.webContents, IPC_CHANNELS.DEEP_LINK_NAVIGATE, pendingNavigate)
      pendingNavigate = null
    }
  })

  // Nothing attaches as a guest without a partition this app recognises and a `src`
  // inside that partition's allow-list, and every guest gets its webPreferences
  // rewritten on the way in — the renderer's attributes are a request, not the
  // setting. Electron reads the object it handed us, so the sanitizer mutates.
  win.webContents.on('will-attach-webview', (event, webPreferences, params) => {
    const partition = resolveAttachPartition(
      params as unknown as Record<string, unknown>,
      webPreferences as unknown as Record<string, unknown>
    )
    const decision = decideWebviewAttach({ partition, src: params.src })
    if (!decision.allowed) {
      // Code only, no context: the refusal reason is one of two closed values and
      // neither is worth a new entry in the log context-key allowlist.
      logger.warn('app', 'app.webview_attach_refused')
      event.preventDefault()
      return
    }
    sanitizeWebviewPreferences(
      webPreferences as unknown as Record<string, unknown>,
      decision.policy
    )
  })

  win.webContents.setWindowOpenHandler((details) => {
    try {
      const parsed = new URL(details.url)
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        shell.openExternal(details.url)
      }
    } catch {
      // ignore invalid URLs
    }
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

// Bring the existing window to the foreground (used when a deep link arrives).
function focusMainWindow(): void {
  const win = mainWindow ?? BrowserWindow.getAllWindows()[0] ?? null
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

// Focus the app and route the renderer in response to a birdbrain:// URL.
function dispatchDeepLink(url: string | null): void {
  if (!url) return
  const target = parseDeepLink(url)
  focusMainWindow()
  if (!target) return
  if (mainWindow && !mainWindow.webContents.isLoading()) {
    sendEvent(mainWindow.webContents, IPC_CHANNELS.DEEP_LINK_NAVIGATE, target)
  } else {
    pendingNavigate = target
  }
}

function registerProtocolClient(): void {
  if (process.defaultApp) {
    // electron-vite dev: register the electron binary plus the entry script so
    // the OS relaunches the right target.
    if (process.argv.length >= 2) {
      app.setAsDefaultProtocolClient(DEEP_LINK_SCHEME, process.execPath, [resolve(process.argv[1])])
    }
  } else {
    app.setAsDefaultProtocolClient(DEEP_LINK_SCHEME)
  }
}

// Navigation policy for every webview guest. Partition-aware since #401: the MHTML
// evidence viewer gets exactly one file:// load and nothing after it, while the
// Wayback replay pane may follow archive.org's own redirects but never leaves the
// replay prefix. A guest on any other partition navigates nowhere.
app.on('web-contents-created', (_event, contents) => {
  if (contents.getType() !== 'webview') return
  const partition = webviewPartitionOf(contents)
  let initialLoadDone = false
  const guard = (event: Electron.Event, url: string): void => {
    if (decideWebviewNavigation({ partition, url, initialLoadDone }) === 'allow') {
      initialLoadDone = true
      return
    }
    event.preventDefault()
  }
  contents.on('will-navigate', guard)
  // Server-side redirects do not raise will-navigate, and archive.org replay URLs
  // redirect to the nearest snapshot as a matter of course.
  contents.on('will-redirect', guard)
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))
})

// A single-instance lock is required so a deep link launched while the app is
// already running routes into this process (via second-instance) instead of
// spawning a second window.
const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  app.quit()
} else {
  registerProtocolClient()

  // Windows/Linux: the second launch hands its argv to the primary instance.
  app.on('second-instance', (_event, argv) => {
    // Unconditionally, before the dispatch: an ordinary relaunch carries no deep link,
    // and dispatchDeepLink() returns early on one — so routing focus through it alone
    // meant a relaunch raised nothing and the second process exited 0 in silence (#642).
    focusMainWindow()
    dispatchDeepLink(findDeepLinkInArgv(argv))
  })

  // macOS delivers deep links through open-url, whether or not the app is running.
  app.on('open-url', (event, url) => {
    event.preventDefault()
    dispatchDeepLink(url)
  })

  app
    .whenReady()
    .then(async () => {
      // Initialize database
      const userDataPath = process.env.BIRDBRAIN_USER_DATA || app.getPath('userData')

      // Logger init must run before anything else in this block that can
      // throw during startup — otherwise the startup crash the feature exists
      // to capture is the one case it cannot capture. initInstallationId does
      // uncaught synchronous fs reads/writes under userData; if that throws
      // before the logger exists, the uncaughtException handler shows a
      // dialog claiming a diagnostic log was saved while logger is still the
      // no-op singleton and nothing was written.
      //
      // detectInstallFormat, not process.platform: SessionRecord promises the
      // package format, and on Linux the AppImage/deb/archive distinction is
      // exactly what a crash report needs. Export the existing helper from
      // diagnostics.ts rather than reimplementing it — it already reads the
      // APPIMAGE env var and the electron-builder package-type marker.
      const session = startSession(join(userDataPath, 'logs'), {
        version: app.getVersion(),
        platform: process.platform,
        installFormat: detectInstallFormat(app.isPackaged)
      })
      initLogger(userDataPath, session.sessionId)
      // A Phase 1 tester sends only birdbrain.log via Reveal, so this entry is
      // the ONLY place installation, platform and package format are recorded.
      // Without them a standalone log cannot correlate repeat reports to one
      // installation or distinguish appimage/deb/nsis failures.
      logger.info('app', 'app.session_start', {
        version: ident(app.getVersion().replace(/\./g, '-')),
        platform: tag(process.platform, 'platform'),
        installFormat: tag(session.installFormat, 'installFormat'),
        packaged: app.isPackaged
      })

      // Awaited: initDatabase takes the pre-migration snapshot (#413) before it
      // migrates, and the snapshot is an async online backup.
      await initDatabase(join(userDataPath, 'birdbrain.db'))
      initSettings(userDataPath)
      initInstallationId(userDataPath)
      // Splitting this into a second entry is the cost of initialising the
      // logger first — the alternative is initialising the installation id
      // first and losing crash capture for the window in which it runs. A bug
      // report reads both lines from the same sessionId, so nothing is lost
      // analytically.
      logger.info('app', 'app.installation_id', { installationId: ident(getInstallationId()) })
      // logEvent wires the durable logger in explicitly — signingKey.ts must
      // not statically import it (see the note at the top of that file: it is
      // loaded by tests/setup/signing-key.ts for every unit test, before a
      // test file's own electron mock is established).
      initSigningKey(userDataPath, {
        logEvent: (code) => logger.warn('signingKey', code)
      })
      initServerToken(userDataPath)

      // Use storagePath from settings, fall back to default if empty or unwritable
      const settings = getSettings()
      const defaultCapturesDir = join(userDataPath, 'captures')
      const capturesDir = settings.storagePath || defaultCapturesDir
      try {
        initStorage(capturesDir)
      } catch (err) {
        logger.warn('app', 'app.storage_init_failed', undefined, err)
        initStorage(defaultCapturesDir)
      }

      // Seed the bundled demonstration case (#405). Strictly after the storage
      // root and the signing key, because it imports a real Case Archive and
      // signs an import custody entry for it; awaited so the case exists before
      // the window opens and the case tour looks for one. Never throws — a
      // missing or unimportable fixture costs the demo case and nothing else.
      await seedDemoCaseIfNeeded()

      // The data half of the Exhibit-model migration (#1147). It runs HERE, not
      // in `runMigrations`, because it appends to each Case's chain and
      // regenerates thumbnails: signing key, settings and storage root all have
      // to exist first, and all three are initialised above. Idempotent, so a
      // reopen appends nothing; awaited so no read path sees a half-numbered
      // Case.
      //
      // After the demo seed rather than before it: the import assigns the demo
      // Case's Exhibit rows itself (captureRepo's `backfillExhibitsForCaptures`
      // call), but the `renumber` entry and the anchored thumbnails come only
      // from a backfill pass, so running first would leave the Case the tour is
      // about waiting for the second launch to get them.
      await runExhibitBackfill({ toolVersion: app.getVersion() })

      // Build the Selector Lifecycle. Its emitter broadcasts rematched events
      // to every renderer; injecting via factory keeps Electron out of the
      // lifecycle module and lets tests pass a recording fake.
      const selectorLifecycle = createSelectorLifecycle({
        emitRematched: (event: SelectorRematchedEvent) => {
          for (const win of BrowserWindow.getAllWindows()) {
            sendEvent(win.webContents, IPC_CHANNELS.SELECTOR_REMATCHED, event)
          }
        }
      })

      // Trusted-timestamp worker (#120). Stamps captures out-of-band so the capture
      // path never blocks on the TSA; rebuilds the mirror + retries pending on start.
      const timestampWorker = createTimestampWorker()
      timestampWorker.start()

      const captureLifecycle = createCaptureLifecycle({
        selectorLifecycle,
        enqueueTimestamp: (captureId) => timestampWorker.enqueue(captureId)
      })

      // Background recapture queue (#recapture). Renders pages in a hidden window
      // and reuses the capture pipeline's observability events, mirroring how the
      // capture server broadcasts to the (lazily created) main window.
      const recaptureService = createRecaptureService({
        renderPage: renderPageInHiddenWindow,
        captureLifecycle,
        emitEvent: (event) => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            sendEvent(mainWindow.webContents, IPC_CHANNELS.CAPTURE_ACTIVITY, event)
          }
        },
        emitNewCapture: (capture) => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            sendEvent(mainWindow.webContents, IPC_CHANNELS.NEW_CAPTURE, capture)
          }
        }
      })

      // Update-delivery service (notify/check-only). Broadcasts status transitions
      // to the renderer; reads the release channel + auto-check policy from settings.
      updaterService = createUpdaterService({
        emit: (updateStatus) => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            sendEvent(mainWindow.webContents, IPC_CHANNELS.UPDATE_STATUS, updateStatus)
          }
        },
        getChannel: () => getSettings().releaseChannel,
        isAutoCheckEnabled: () => getSettings().autoCheckForUpdates
      })

      // Session state machine (#228). Owns the active case, recording flag,
      // capture count and extension heartbeat; window access is inverted into
      // these callbacks so the service itself stays Electron-free.
      const sessionService = createSessionService({
        emitSessionChange: (payload) => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            sendEvent(mainWindow.webContents, IPC_CHANNELS.SESSION_STATE_CHANGED, payload)
          }
        },
        emitExtensionConnection: (connected) => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            sendEvent(mainWindow.webContents, IPC_CHANNELS.EXTENSION_CONNECTION, { connected })
          }
        }
      })

      // Register IPC handlers
      registerIpcHandlers({
        selectorLifecycle,
        captureLifecycle,
        recaptureService,
        updaterService,
        sessionService
      })

      // Start capture server and extension connection monitor
      await startCaptureServer({ selectorLifecycle, captureLifecycle, sessionService })
      startExtensionConnectionCheck()

      // Create window and connect to capture server
      const win = createWindow()
      setMainWindow(win)
      setLoggerWindow(win)

      // Arm the updater once the window exists so status events have a target.
      updaterService.start()

      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
          const next = createWindow()
          setMainWindow(next)
          setLoggerWindow(next)
        }
      })

      // Windows/Linux cold start: the deep link is in this process's argv.
      if (process.platform !== 'darwin') {
        dispatchDeepLink(findDeepLinkInArgv(process.argv))
      }
    })
    .catch((err) => {
      // Startup failures are fatal by definition — there is no window to recover
      // into. Log, tell the tester where the log is, and exit rather than linger
      // holding the single-instance lock with nothing on screen.
      logger.error('app', 'app.startup_failed', undefined, err)
      flushSync()
      // The operator already made an explicit, informed choice — decline the
      // acknowledgement dialog in initSigningKey — so exit quietly rather than
      // stacking a second, contradictory "could not start" dialog that implies
      // something broke. app.exit(0): this is not a crash.
      if (err instanceof SigningKeyUnacknowledgedError) {
        app.exit(0)
        return
      }
      // A refused migration is the one startup failure where the state of the
      // user's data is knowable and reassuring: nothing was written. Saying so
      // is the difference between "wait for a fix" and "restore from a backup".
      if (err instanceof PreMigrationSnapshotError) {
        dialog.showErrorBox(
          'Birdbrain could not snapshot your database',
          'The database upgrade was NOT started, so none of your cases, captures or notes ' +
            'have been changed. ' +
            'Birdbrain takes a snapshot before upgrading its database, and this time it could not — ' +
            'usually a full disk or a read-only data folder. Free some space and start Birdbrain again. ' +
            'A diagnostic log has been saved in the logs folder of your Birdbrain data directory.'
        )
      } else {
        dialog.showErrorBox(
          'Birdbrain could not start',
          'A diagnostic log has been saved. You can attach it to a bug report — see the logs folder in your Birdbrain data directory.'
        )
      }
      // Same reasoning as the uncaughtException handler above: exit, not quit,
      // so before-quit does not clear the lock on a startup crash.
      app.exit(1)
    })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })

  app.on('before-quit', async () => {
    // markCleanExit MUST run first and synchronously. Electron does not await
    // an async before-quit listener, so anything sequenced after `await
    // stopCaptureServer()` may never run — which would leave session.lock in
    // place and make every ordinary quit look like a crash on next launch.
    markCleanExit(join(process.env.BIRDBRAIN_USER_DATA || app.getPath('userData'), 'logs'))
    disposeLogger()

    stopExtensionConnectionCheck()
    updaterService?.dispose()
    await stopCaptureServer()
    closeDatabase()
  })
}
