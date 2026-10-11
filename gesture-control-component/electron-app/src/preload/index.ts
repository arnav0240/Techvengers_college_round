import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

export interface BackendStatus {
  pyautoDir: string
  daemonRunning: boolean
  serverRunning: boolean
  health: { ok: boolean; backend?: string; error?: string }
}

const api = {
  backendStatus: (): Promise<BackendStatus> => ipcRenderer.invoke('backend:status'),
  backendRestart: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('backend:restart')
}

export type BackendAPI = typeof api

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
