import { app } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'

export function getExtensionPath(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'extension')
  }
  // electron-vite compiles main to out/main/, so walk up to project root
  return join(__dirname, '../../extension/dist')
}

export function extensionPathExists(): boolean {
  return existsSync(getExtensionPath())
}
