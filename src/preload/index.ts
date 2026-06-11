import { contextBridge, ipcRenderer } from 'electron'
import type { SessionListResult, ForkableMessage, SessionInfo, ForkPoint } from '../renderer/src/types/session'

const api = {
  sendCommand: (sessionPath: string | null, command: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('pi:sendCommand', sessionPath, command),

  sendExtensionUIResponse: (sessionPath: string | null, response: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('pi:sendExtensionUIResponse', sessionPath, response),

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

  onWorkerStatus: (callback: (data: { sessionPath: string; role: string; status: string; isStreaming: boolean }) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { sessionPath: string; role: string; status: string; isStreaming: boolean }) => callback(data)
    ipcRenderer.on('worker:status', handler)
    return () => ipcRenderer.removeListener('worker:status', handler)
  },

  getState: (): Promise<{ connected: boolean }> =>
    ipcRenderer.invoke('pi:getState'),

  getAvailableModels: (sessionPath: string | null): Promise<{ ok: boolean; data?: unknown; error?: string }> =>
    ipcRenderer.invoke('pi:getAvailableModels', sessionPath),

  setModel: (sessionPath: string | null, model: string, provider?: string): Promise<{ ok: boolean; data?: unknown; error?: string }> =>
    ipcRenderer.invoke('pi:setModel', sessionPath, model, provider),

  cycleModel: (sessionPath: string | null, direction?: 'forward' | 'backward'): Promise<{ ok: boolean; data?: unknown; error?: string }> =>
    ipcRenderer.invoke('pi:cycleModel', sessionPath, direction),

  getModelInfo: (sessionPath: string | null): Promise<{ ok: boolean; data?: { model: unknown; thinkingLevel: unknown }; error?: string }> =>
    ipcRenderer.invoke('pi:getModelInfo', sessionPath),

  start: (): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('pi:start'),

  stop: (): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('pi:stop'),

  listSessions: (): Promise<SessionListResult> =>
    ipcRenderer.invoke('session:listSessions'),

  getForkMessages: (sessionPath: string | null): Promise<ForkableMessage[]> =>
    ipcRenderer.invoke('session:getForkMessages', sessionPath),

  forkAtEntry: (sessionPath: string | null, entryId: string, name?: string): Promise<{ success: boolean; text?: string; error?: string }> =>
    ipcRenderer.invoke('session:forkAtEntry', sessionPath, entryId, name),

  switchSession: (sessionPath: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('session:switchSession', sessionPath),

  newSession: (sessionPath: string | null, name: string, parentSessionPath?: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('session:newSession', sessionPath, name, parentSessionPath),

  renameSession: (sessionPath: string | null, name: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('session:renameSession', sessionPath, name),

  getCurrentSession: (): Promise<SessionInfo | null> =>
    ipcRenderer.invoke('session:getCurrentSession'),

  refreshSessions: (): Promise<SessionListResult> =>
    ipcRenderer.invoke('session:refreshSessions'),

  getMessages: (sessionPath: string | null): Promise<unknown[]> =>
    ipcRenderer.invoke('session:getMessages', sessionPath),

  deleteSession: (sessionPath: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('session:deleteSession', sessionPath),

  getForkPoints: (sessionPath: string): Promise<ForkPoint[]> =>
    ipcRenderer.invoke('session:getForkPoints', sessionPath),

  setSessionStatus: (sessionPath: string, status: 'active' | 'completed'): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('session:setSessionStatus', sessionPath, status),

  clearSession: (sessionPath: string | null): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('session:clearSession', sessionPath),

  openDirectory: (): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('project:openDirectory'),

  getMessagesForSession: (sessionPath: string): Promise<unknown[]> =>
    ipcRenderer.invoke('session:getMessagesForSession', sessionPath),

  getProviderAuthStatus: (sessionPath: string | null = null): Promise<{ ok: boolean; data?: Record<string, { configured: boolean; source?: string }>; error?: string }> =>
    ipcRenderer.invoke('pi:getProviderAuthStatus', sessionPath),

  setApiKey: (sessionPath: string | null, provider: string, apiKey: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('pi:setApiKey', sessionPath, provider, apiKey),

  removeAuth: (sessionPath: string | null, provider: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('pi:removeAuth', sessionPath, provider),

  registerCustomProvider: (sessionPath: string | null, provider: string, config: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('pi:registerCustomProvider', sessionPath, provider, config),

  testProvider: (sessionPath: string | null, provider: string, overrides?: { baseUrl?: string; apiKey?: string }): Promise<{ ok: boolean; error?: string; latencyMs?: number }> =>
    ipcRenderer.invoke('provider:test', sessionPath, provider, overrides),

  getProviderConfig: (provider: string): Promise<{ ok: boolean; config?: Record<string, unknown>; error?: string }> =>
    ipcRenderer.invoke('provider:getConfig', provider),

  listCustomProviders: (): Promise<{ ok: boolean; providers: Record<string, { baseUrl: string; name?: string }> }> =>
    ipcRenderer.invoke('provider:listCustomProviders'),

  deleteCustomProvider: (provider: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('provider:deleteCustomProvider', provider),

  removeModelFromProvider: (provider: string, modelId: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('provider:removeModel', provider, modelId),

  openConfigDir: (): void =>
    ipcRenderer.send('app:openConfigDir'),

  workerEnsureReady: (sessionPath: string): Promise<{ ok: boolean; status?: string; error?: string }> =>
    ipcRenderer.invoke('worker:ensureReady', sessionPath),

  workerGetStatus: (): Promise<Array<{ sessionPath: string; role: string; status: string; isStreaming: boolean }>> =>
    ipcRenderer.invoke('worker:getStatus'),

  workerDispose: (sessionPath: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('worker:dispose', sessionPath),

  workerSetIdleTimeout: (minutes: number): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('worker:setIdleTimeout', minutes),

  workerGetIdleTimeout: (): Promise<{ ok: boolean; minutes: number }> =>
    ipcRenderer.invoke('worker:getIdleTimeout'),

  workerSetMaxSecondaries: (n: number): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('worker:setMaxSecondaries', n),

  workerGetMaxSecondaries: (): Promise<{ ok: boolean; maxSecondaries: number }> =>
    ipcRenderer.invoke('worker:getMaxSecondaries'),

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

  checkGitAvailable: (): Promise<{ available: boolean }> =>
    ipcRenderer.invoke('git:checkAvailable'),

  gitStatus: (): Promise<{
    ok: boolean
    data?: { branch: string; ahead: number; behind: number; files: Array<{ path: string; status: string; staged: boolean }> }
    error?: string
  }> =>
    ipcRenderer.invoke('git:status'),

  gitDiff: (filePath: string, staged?: boolean): Promise<{ ok: boolean; data?: string; error?: string }> =>
    ipcRenderer.invoke('git:diff', filePath, staged),

  gitDiffCached: (): Promise<{ ok: boolean; data?: string; error?: string }> =>
    ipcRenderer.invoke('git:diffCached'),

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

  openExternal: (url: string): void =>
    ipcRenderer.send('app:openExternal', url),

  showItemInFolder: (fullPath: string): void =>
    ipcRenderer.send('app:showItemInFolder', fullPath),

  copyToClipboard: (text: string): void =>
    ipcRenderer.send('app:copyToClipboard', text),

  getProjectPath: (): Promise<string> =>
    ipcRenderer.invoke('app:getProjectPath'),

  getRecentProjects: (): Promise<Array<{ path: string; name: string; lastOpened: string }>> =>
    ipcRenderer.invoke('app:getRecentProjects'),

  clearRecentProjects: (): Promise<void> =>
    ipcRenderer.invoke('app:clearRecentProjects'),

  getLastSession: (): Promise<string | null> =>
    ipcRenderer.invoke('session:getLastSession'),

  saveLastSession: (sessionPath: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('session:saveLastSession', sessionPath),
}

contextBridge.exposeInMainWorld('api', api)

export type ElectronApi = typeof api
