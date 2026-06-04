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

  testProvider: (provider: string, overrides?: { baseUrl?: string; apiKey?: string }): Promise<{ ok: boolean; error?: string; latencyMs?: number }> =>
    ipcRenderer.invoke('provider:test', provider, overrides),

  getProviderConfig: (provider: string): Promise<{ ok: boolean; config?: Record<string, unknown>; error?: string }> =>
    ipcRenderer.invoke('provider:getConfig', provider),

  openConfigDir: (): void =>
    ipcRenderer.send('app:openConfigDir'),

  readDirectory: (dirPath: string): Promise<{ ok: boolean; entries?: Array<{ name: string; path: string; isDirectory: boolean }>; error?: string }> =>
    ipcRenderer.invoke('fs:readDirectory', dirPath),

  readFile: (filePath: string): Promise<{ ok: boolean; data?: { content: string; name: string; ext: string; path: string }; error?: string }> =>
    ipcRenderer.invoke('fs:readFile', filePath),

  writeFile: (filePath: string, content: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('fs:writeFile', filePath, content),

  searchFiles: (query: string, options?: { includePattern?: string; excludePattern?: string; maxResults?: number }): Promise<{
    ok: boolean
    results?: Array<{
      filePath: string
      relativePath: string
      matches: Array<{ lineNumber: number; lineContent: string; matchStart: number; matchEnd: number }>
    }>
    error?: string
  }> =>
    ipcRenderer.invoke('fs:search', query, options),

  watchStart: (): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('fs:watchStart'),

  watchStop: (): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('fs:watchStop'),

  onFsChanged: (callback: () => void): (() => void) => {
    const handler = () => callback()
    ipcRenderer.on('fs:changed', handler)
    return () => ipcRenderer.removeListener('fs:changed', handler)
  },

  gitStatus: (): Promise<{
    ok: boolean
    data?: { branch: string; ahead: number; behind: number; files: Array<{ path: string; status: string; staged: boolean }> }
    error?: string
  }> =>
    ipcRenderer.invoke('git:status'),

  gitDiff: (filePath: string, staged?: boolean): Promise<{ ok: boolean; data?: string; error?: string }> =>
    ipcRenderer.invoke('git:diff', filePath, staged),

  gitStage: (filePaths: string[]): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('git:stage', filePaths),

  gitUnstage: (filePaths: string[]): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('git:unstage', filePaths),

  gitCommit: (message: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('git:commit', message),

  gitDiscard: (filePaths: string[]): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('git:discard', filePaths),

  gitLog: (options?: { maxCount?: number; skip?: number }): Promise<{
    ok: boolean
    data?: Array<{
      hash: string
      shortHash: string
      message: string
      body: string
      author_name: string
      author_email: string
      date: string
      refs: string
    }>
    error?: string
  }> =>
    ipcRenderer.invoke('git:log', options),

  gitCommitDetail: (hash: string): Promise<{
    ok: boolean
    data?: {
      hash: string
      shortHash: string
      message: string
      body: string
      author_name: string
      author_email: string
      date: string
      refs: string
      files: Array<{ path: string; status: string; additions: number; deletions: number }>
    }
    error?: string
  }> =>
    ipcRenderer.invoke('git:commitDetail', hash),

  gitCommitFileDiff: (hash: string, filePath: string): Promise<{ ok: boolean; data?: string; error?: string }> =>
    ipcRenderer.invoke('git:commitFileDiff', hash, filePath),

  listSkills: (): Promise<{
    ok: boolean
    data?: Array<{ name: string; description: string; source: string; scope: string }>
    error?: string
  }> =>
    ipcRenderer.invoke('skills:list'),

  listMcpServers: (): Promise<{
    ok: boolean
    data?: Array<{ name: string; command: string; args?: string[]; env?: Record<string, string> }>
    error?: string
  }> =>
    ipcRenderer.invoke('mcp:list'),

  mcpPing: (serverConfig: { command: string; args?: string[]; env?: Record<string, string> }): Promise<{ ok: boolean; connected: boolean }> =>
    ipcRenderer.invoke('mcp:ping', serverConfig),

  terminalCreate: (ptyId: string, cwd?: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('terminal:create', ptyId, cwd),

  terminalWrite: (ptyId: string, data: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('terminal:write', ptyId, data),

  terminalResize: (ptyId: string, cols: number, rows: number): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('terminal:resize', ptyId, cols, rows),

  terminalKill: (ptyId: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('terminal:kill', ptyId),

  onTerminalData: (callback: (ptyId: string, data: string) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, ptyId: string, data: string) => callback(ptyId, data)
    ipcRenderer.on('terminal:data', handler)
    return () => ipcRenderer.removeListener('terminal:data', handler)
  },

  onTerminalExit: (callback: (ptyId: string) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, ptyId: string) => callback(ptyId)
    ipcRenderer.on('terminal:exit', handler)
    return () => ipcRenderer.removeListener('terminal:exit', handler)
  },

  showItemInFolder: (fullPath: string): void =>
    ipcRenderer.send('app:showItemInFolder', fullPath),

  copyToClipboard: (text: string): void =>
    ipcRenderer.send('app:copyToClipboard', text),

  getProjectPath: (): Promise<string> =>
    ipcRenderer.invoke('app:getProjectPath'),
}

contextBridge.exposeInMainWorld('api', api)

export type ElectronApi = typeof api
