import { app } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'

export function getExtensionPath(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'extension')
  }
  // In dev mode, process.cwd() is the project root
  return join(process.cwd(), 'extension', 'dist')
}

export function extensionPathExists(): boolean {
  return existsSync(getExtensionPath())
}
