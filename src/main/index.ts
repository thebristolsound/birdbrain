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
      sandbox: false,
      webviewTag: true
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return mainWindow
}

app.whenReady().then(async () => {
  // Initialize database
  const userDataPath = process.env.BIRDBRAIN_USER_DATA || app.getPath('userData')
  initDatabase(join(userDataPath, 'birdbrain.db'))
  initSettings(userDataPath)
  initInstallationId(userDataPath)

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

  // Register IPC handlers
  registerIpcHandlers()

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
