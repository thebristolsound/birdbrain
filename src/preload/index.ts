import { contextBridge } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Expose electron APIs to renderer
// Additional APIs will be added in later specs
contextBridge.exposeInMainWorld('electron', electronAPI)
