import { app, BrowserWindow, ipcMain, nativeTheme } from 'electron'
import { join } from 'path'
import { PiBridge } from './pi-bridge'
import { ScreenshotServer, type ScreenshotOptions } from './screenshot-server'

let mainWindow: BrowserWindow | null = null
let piBridge: PiBridge | null = null
const screenshotServer = new ScreenshotServer()

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
    win.webContents.send(channel, data)
  })
}

function initPiBridge(): void {
  piBridge = new PiBridge(process.cwd())

  piBridge.on('event', (data: unknown) => {
    broadcastToRenderers('pi:event', data)
  })

  piBridge.on('response', (data: unknown) => {
    broadcastToRenderers('pi:response', data)
  })

  piBridge.on('extension_ui_request', (data: unknown) => {
    broadcastToRenderers('pi:extensionUiRequest', data)
  })

  piBridge.on('connected', () => {
    broadcastToRenderers('pi:stateChanged', { connected: true })
  })

  piBridge.on('disconnected', () => {
    broadcastToRenderers('pi:stateChanged', { connected: false })
  })

  piBridge.on('error', (err: Error) => {
    console.error('[PiBridge]', err.message)
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
      initPiBridge()
    }
    try {
      await piBridge!.start()
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

  ipcMain.handle('screenshot:capture', async (_event, options: ScreenshotOptions) => {
    try {
      const result = await screenshotServer.capture(options)
      return { ok: true, data: result }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })
}

app.whenReady().then(() => {
  nativeTheme.themeSource = 'dark'
  initPiBridge()
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
    console.error('[PiBridge] Error during shutdown:', err.message)
  })
  screenshotServer.dispose().catch((err: Error) => {
    console.error('[ScreenshotServer] Error during shutdown:', err.message)
  })
})
