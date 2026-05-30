import { contextBridge, ipcRenderer } from 'electron'
import type { SessionListResult, ForkableMessage, SessionInfo, ForkPoint } from '../renderer/src/types/session'

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

  listSessions: (): Promise<SessionListResult> =>
    ipcRenderer.invoke('session:listSessions'),

  getForkMessages: (): Promise<ForkableMessage[]> =>
    ipcRenderer.invoke('session:getForkMessages'),

  forkAtEntry: (entryId: string, name?: string): Promise<{ success: boolean; text?: string; error?: string }> =>
    ipcRenderer.invoke('session:forkAtEntry', entryId, name),

  switchSession: (sessionPath: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('session:switchSession', sessionPath),

  newSession: (parentSessionPath?: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('session:newSession', parentSessionPath),

  renameSession: (name: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('session:renameSession', name),

  getCurrentSession: (): Promise<SessionInfo | null> =>
    ipcRenderer.invoke('session:getCurrentSession'),

  refreshSessions: (): Promise<SessionListResult> =>
    ipcRenderer.invoke('session:refreshSessions'),

  getMessages: (): Promise<unknown[]> =>
    ipcRenderer.invoke('session:getMessages'),

  deleteSession: (sessionPath: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('session:deleteSession', sessionPath),

  getForkPoints: (sessionPath: string): Promise<ForkPoint[]> =>
    ipcRenderer.invoke('session:getForkPoints', sessionPath),

  clearSession: (): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('session:clearSession'),
}

contextBridge.exposeInMainWorld('api', api)

export type ElectronApi = typeof api
