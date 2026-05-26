import { contextBridge, ipcRenderer } from 'electron'

const api = {
  sendCommand: (command: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('pi:sendCommand', command),

  sendExtensionUIResponse: (response: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('pi:sendExtensionUIResponse', response),

  onEvent: (callback: (data: unknown) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data)
    ipcRenderer.on('pi:event', handler)
    return () => ipcRenderer.removeListener('pi:event', handler)
  },

  onResponse: (callback: (data: unknown) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data)
    ipcRenderer.on('pi:response', handler)
    return () => ipcRenderer.removeListener('pi:response', handler)
  },

  onExtensionUiRequest: (callback: (data: unknown) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data)
    ipcRenderer.on('pi:extensionUiRequest', handler)
    return () => ipcRenderer.removeListener('pi:extensionUiRequest', handler)
  },

  onStateChanged: (callback: (state: { connected: boolean }) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { connected: boolean }) => callback(data)
    ipcRenderer.on('pi:stateChanged', handler)
    return () => ipcRenderer.removeListener('pi:stateChanged', handler)
  },

  getState: (): Promise<{ connected: boolean }> =>
    ipcRenderer.invoke('pi:getState'),

  start: (): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('pi:start'),

  stop: (): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('pi:stop'),
}

contextBridge.exposeInMainWorld('api', api)

export type ElectronApi = typeof api
