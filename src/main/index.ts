import { app, BrowserWindow, shell } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { initDatabase, closeDatabase } from '@main/services/database'
import { initStorage } from '@main/services/storage'
import {
  startCaptureServer,
  stopCaptureServer,
  setMainWindow,
  startExtensionConnectionCheck,
  stopExtensionConnectionCheck
} from '@main/services/captureServer'
import { registerIpcHandlers } from '@main/ipcHandlers'
import { initSettings, getSettings } from '@main/services/settings'
import { initInstallationId } from '@main/services/installationId'
import { initServerToken } from '@main/services/serverToken'
import { createSelectorLifecycle } from '@main/services/selectorLifecycle'
import { IPC_CHANNELS, type SelectorRematchedEvent } from '@shared/ipc'

function createWindow(): BrowserWindow {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: 'Birdbrain',
    backgroundColor: '#000000',
    ...(process.platform === 'linux' || process.platform === 'win32'
      ? { icon: join(__dirname, '../../resources/icon.png') }
      : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      webviewTag: true
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
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
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return mainWindow
}

// Enforce security on all web contents (defense-in-depth for webviews)
app.on('web-contents-created', (_event, contents) => {
  if (contents.getType() === 'webview') {
    // Allow the initial file:// load, block all subsequent navigations
    let initialLoadDone = false
    contents.on('will-navigate', (event, url) => {
      if (!initialLoadDone && url.startsWith('file://')) {
        initialLoadDone = true
        return
      }
      event.preventDefault()
    })
  }
})

app.whenReady().then(async () => {
  // Initialize database
  const userDataPath = process.env.BIRDBRAIN_USER_DATA || app.getPath('userData')
  initDatabase(join(userDataPath, 'birdbrain.db'))
  initSettings(userDataPath)
  initInstallationId(userDataPath)
  initServerToken(userDataPath)

  // Use storagePath from settings, fall back to default if empty or unwritable
  const settings = getSettings()
  const defaultCapturesDir = join(userDataPath, 'captures')
  const capturesDir = settings.storagePath || defaultCapturesDir
  try {
    initStorage(capturesDir)
  } catch (err) {
    console.warn(`Failed to initialize storage at "${capturesDir}", falling back to default:`, err)
    initStorage(defaultCapturesDir)
  }

  // Build the Selector Lifecycle. Its emitter broadcasts rematched events
  // to every renderer; injecting via factory keeps Electron out of the
  // lifecycle module and lets tests pass a recording fake.
  const selectorLifecycle = createSelectorLifecycle({
    emitRematched: (event: SelectorRematchedEvent) => {
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send(IPC_CHANNELS.SELECTOR_REMATCHED, event)
      }
    }
  })

  // Register IPC handlers
  registerIpcHandlers({ selectorLifecycle })

  // Start capture server and extension connection monitor
  await startCaptureServer()
  startExtensionConnectionCheck()

  // Create window and connect to capture server
  const mainWindow = createWindow()
  setMainWindow(mainWindow)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      const win = createWindow()
      setMainWindow(win)
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', async () => {
  stopExtensionConnectionCheck()
  await stopCaptureServer()
  closeDatabase()
})
