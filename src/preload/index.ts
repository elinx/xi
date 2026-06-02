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

  getAvailableModels: (): Promise<{ ok: boolean; data?: unknown; error?: string }> =>
    ipcRenderer.invoke('pi:getAvailableModels'),

  setModel: (model: string, provider?: string): Promise<{ ok: boolean; data?: unknown; error?: string }> =>
    ipcRenderer.invoke('pi:setModel', model, provider),

  cycleModel: (direction?: 'forward' | 'backward'): Promise<{ ok: boolean; data?: unknown; error?: string }> =>
    ipcRenderer.invoke('pi:cycleModel', direction),

  getModelInfo: (): Promise<{ ok: boolean; data?: { model: unknown; thinkingLevel: unknown }; error?: string }> =>
    ipcRenderer.invoke('pi:getModelInfo'),

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

  newSession: (name: string, parentSessionPath?: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('session:newSession', name, parentSessionPath),

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

  setSessionStatus: (sessionPath: string, status: 'active' | 'completed'): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('session:setSessionStatus', sessionPath, status),

  clearSession: (): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('session:clearSession'),

  openDirectory: (): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('project:openDirectory'),

  getMessagesForSession: (sessionPath: string): Promise<unknown[]> =>
    ipcRenderer.invoke('session:getMessagesForSession', sessionPath),

  getProviderAuthStatus: (): Promise<{ ok: boolean; data?: Record<string, { configured: boolean; source?: string }>; error?: string }> =>
    ipcRenderer.invoke('pi:getProviderAuthStatus'),

  setApiKey: (provider: string, apiKey: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('pi:setApiKey', provider, apiKey),

  removeAuth: (provider: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('pi:removeAuth', provider),

  registerCustomProvider: (provider: string, config: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('pi:registerCustomProvider', provider, config),

  openConfigDir: (): void =>
    ipcRenderer.send('app:openConfigDir'),

  readDirectory: (dirPath: string): Promise<{ ok: boolean; entries?: Array<{ name: string; path: string; isDirectory: boolean }>; error?: string }> =>
    ipcRenderer.invoke('fs:readDirectory', dirPath),

  readFile: (filePath: string): Promise<{ ok: boolean; data?: { content: string; name: string; ext: string; path: string }; error?: string }> =>
    ipcRenderer.invoke('fs:readFile', filePath),
}

contextBridge.exposeInMainWorld('api', api)

export type ElectronApi = typeof api
