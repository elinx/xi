import { app, BrowserWindow, ipcMain, nativeTheme } from 'electron'
import { join } from 'path'
import { PiSDKBridge } from './pi-sdk-bridge'
import * as sessionService from './session-service'
import type { SessionInfo, ForkableMessage, ForkPoint } from '../renderer/src/types/session'

let mainWindow: BrowserWindow | null = null
let piBridge: PiSDKBridge | null = null
let initialSessionPath: string | undefined

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    backgroundColor: '#111827',
    titleBarStyle: 'hiddenInset',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function broadcastToRenderers(channel: string, data: unknown): void {
  BrowserWindow.getAllWindows().forEach((win) => {
    if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
      try {
        win.webContents.send(channel, data)
      } catch {}
    }
  })
}

function initPiBridge(sessionPath?: string): void {
  piBridge = new PiSDKBridge()
  initialSessionPath = sessionPath

  piBridge.on('event', (data: unknown) => {
    // In SDK mode, extension_ui_request arrives as a regular event
    if (typeof data === 'object' && data !== null) {
      const obj = data as Record<string, unknown>
      if (obj.type === 'extension_ui_request') {
        broadcastToRenderers('pi:extensionUiRequest', data)
        return
      }
    }
    broadcastToRenderers('pi:event', data)
  })

  piBridge.on('response', (data: unknown) => {
    broadcastToRenderers('pi:response', data)
  })

  piBridge.on('connected', () => {
    broadcastToRenderers('pi:stateChanged', { connected: true })
  })

  piBridge.on('disconnected', () => {
    broadcastToRenderers('pi:stateChanged', { connected: false })
  })

  piBridge.on('error', (err: Error) => {
    console.error('[PiSDKBridge]', err.message)
  })
}

function registerIpcHandlers(): void {
  ipcMain.handle('pi:sendCommand', (_event, command: Record<string, unknown>) => {
    if (!piBridge?.isConnected) return { ok: false, error: 'Pi not connected' }
    piBridge.sendCommand(command)
    return { ok: true }
  })

  ipcMain.handle('pi:sendExtensionUIResponse', (_event, response: Record<string, unknown>) => {
    if (!piBridge?.isConnected) return { ok: false, error: 'Pi not connected' }
    piBridge.sendExtensionUIResponse(response)
    return { ok: true }
  })

  ipcMain.handle('pi:getState', () => {
    return { connected: piBridge?.isConnected ?? false }
  })

  ipcMain.handle('pi:start', async () => {
    if (!piBridge) {
      let mainSession = sessionService.findMainSession(process.cwd())
      if (mainSession && !mainSession.name) {
        sessionService.nameSession(mainSession.filePath, 'main')
        mainSession = { ...mainSession, name: 'main' }
      }
      initPiBridge(mainSession?.filePath)
    }
    try {
      await piBridge!.start(process.cwd(), initialSessionPath)
      const mainSession = sessionService.findMainSession(process.cwd())
      if (!mainSession || !mainSession.name) {
        try {
          await piBridge!.sendRpcCommand({ type: 'set_session_name', name: 'main' })
        } catch {}
        const sessionPath = piBridge!.sessionFilePath
        if (sessionPath) {
          sessionService.nameSession(sessionPath, 'main', process.cwd())
        }
      }
      return { ok: true }
    } catch (err: unknown) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('pi:stop', async () => {
    try {
      await piBridge?.stop()
      return { ok: true }
    } catch (err: unknown) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('session:listSessions', async () => {
    let currentPath: string | undefined
    try {
      const data = (await piBridge!.sendRpcCommand({ type: 'get_state' })) as Record<string, unknown>
      if (typeof data.sessionFile === 'string') currentPath = data.sessionFile
    } catch {
      currentPath = undefined
    }
    return sessionService.listSessions(currentPath)
  })

  ipcMain.handle('session:getForkMessages', async () => {
    try {
      const data = (await piBridge!.sendRpcCommand({ type: 'get_fork_messages' })) as {
        messages?: ForkableMessage[]
      }
      return data.messages ?? []
    } catch {
      return []
    }
  })

  ipcMain.handle('session:forkAtEntry', async (_event, entryId: string, name?: string) => {
    let parentPath: string | null = null
    try {
      const preState = (await piBridge!.sendRpcCommand({ type: 'get_state' })) as Record<string, unknown>
      parentPath = typeof preState.sessionFile === 'string' ? preState.sessionFile : null
    } catch {}

    try {
      const data = (await piBridge!.sendRpcCommand({ type: 'fork', entryId })) as Record<string, unknown>

      if (name) {
        try {
          await piBridge!.sendRpcCommand({ type: 'set_session_name', name })
        } catch {}
        try {
          const postState = (await piBridge!.sendRpcCommand({ type: 'get_state' })) as Record<string, unknown>
          const childPath = typeof postState.sessionFile === 'string' ? postState.sessionFile : null
          if (childPath) {
            sessionService.nameSession(childPath, name)
          }
        } catch {}
      }

      if (parentPath) {
        sessionService.addForkPoint(parentPath, entryId, name ?? '')
      }

      return { success: true, text: typeof data.text === 'string' ? data.text : undefined }
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('session:switchSession', async (_event, sessionPath: string) => {
    try {
      await piBridge!.sendRpcCommand({ type: 'switch_session', sessionPath })
      return { success: true }
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('session:newSession', async (_event, parentSessionPath?: string) => {
    try {
      const command: Record<string, unknown> = { type: 'new_session' }
      if (parentSessionPath) {
        command.parentSession = parentSessionPath
      }
      await piBridge!.sendRpcCommand(command)
      return { success: true }
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('session:renameSession', async (_event, name: string) => {
    try {
      await piBridge!.sendRpcCommand({ type: 'set_session_name', name })
    } catch {}

    try {
      const data = (await piBridge!.sendRpcCommand({ type: 'get_state' })) as Record<string, unknown>
      const sessionPath = typeof data.sessionFile === 'string' ? data.sessionFile : null
      if (sessionPath) {
        sessionService.nameSession(sessionPath, name)
      }
    } catch {}

    return { success: true }
  })

  ipcMain.handle('session:getCurrentSession', async () => {
    try {
      const data = (await piBridge!.sendRpcCommand({ type: 'get_state' })) as Record<string, unknown>
      const sessionPath = typeof data.sessionFile === 'string' ? data.sessionFile : null
      if (!sessionPath) return null

      const result = sessionService.listSessions()
      for (const project of result.projects) {
        const found = project.allSessions.find((s) => s.filePath === sessionPath)
        if (found) return found
      }
      return null
    } catch {
      return null
    }
  })

  ipcMain.handle('session:refreshSessions', async () => {
    let currentPath: string | undefined
    try {
      const data = (await piBridge!.sendRpcCommand({ type: 'get_state' })) as Record<string, unknown>
      if (typeof data.sessionFile === 'string') currentPath = data.sessionFile
    } catch {
      currentPath = undefined
    }
    return sessionService.listSessions(currentPath)
  })

  ipcMain.handle('session:getMessages', async () => {
    try {
      const data = (await piBridge!.sendRpcCommand({ type: 'get_messages' })) as { messages?: unknown[] }
      return data.messages ?? []
    } catch {
      return []
    }
  })

  ipcMain.handle('session:deleteSession', async (_event, sessionPath: string) => {
    try {
      const stateData = (await piBridge!.sendRpcCommand({ type: 'get_state' })) as Record<string, unknown>
      const currentPath = typeof stateData.sessionFile === 'string' ? stateData.sessionFile : null
      if (currentPath === sessionPath) {
        return { success: false, error: 'Cannot delete the active session' }
      }
    } catch {}

    const result = sessionService.deleteSession(sessionPath)
    if (result) {
      return { success: true }
    }
    return { success: false, error: 'Failed to delete session' }
  })

  ipcMain.handle('session:getForkPoints', async (_event, sessionPath: string) => {
    return sessionService.getForkPoints(sessionPath)
  })

  ipcMain.handle('session:clearSession', async () => {
    try {
      const stateData = (await piBridge!.sendRpcCommand({ type: 'get_state' })) as Record<string, unknown>
      const oldPath = typeof stateData.sessionFile === 'string' ? stateData.sessionFile : null
      const sessionName = typeof stateData.sessionName === 'string' ? stateData.sessionName : null

      if (!oldPath) {
        return { success: false, error: 'No active session to clear' }
      }

      await piBridge!.sendRpcCommand({ type: 'new_session' })

      const newName = sessionName ?? 'main'
      try {
        await piBridge!.sendRpcCommand({ type: 'set_session_name', name: newName })
      } catch {}

      const postState = (await piBridge!.sendRpcCommand({ type: 'get_state' })) as Record<string, unknown>
      const newPath = typeof postState.sessionFile === 'string' ? postState.sessionFile : null
      if (newPath) {
        sessionService.nameSession(newPath, newName)
      }

      sessionService.deleteSession(oldPath)

      return { success: true }
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
}

app.whenReady().then(() => {
  nativeTheme.themeSource = 'dark'
  let mainSession = sessionService.findMainSession(process.cwd())

  if (mainSession && !mainSession.name) {
    sessionService.nameSession(mainSession.filePath, 'main')
    mainSession = { ...mainSession, name: 'main' }
  }

  initPiBridge(mainSession?.filePath)
  registerIpcHandlers()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  piBridge?.stop().catch((err: Error) => {
    console.error('[PiSDKBridge] Error during shutdown:', err.message)
  })
})
