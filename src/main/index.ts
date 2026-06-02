import { app, BrowserWindow, ipcMain, nativeTheme, dialog, shell } from 'electron'
import { join, basename, extname, dirname } from 'path'
import { existsSync, readdirSync, statSync, readFileSync } from 'fs'
import { simpleGit } from 'simple-git'
import { PiSDKBridge } from './pi-sdk-bridge'
import * as sessionService from './session-service'
import type { SessionInfo, ForkableMessage, ForkPoint } from '../renderer/src/types/session'

// Override app name & dock icon so macOS shows "Xi" instead of "Electron"
app.setName('Xi')
if (process.platform === 'darwin') {
  try {
    const dockIconPath = join(__dirname, 'icon.png')
    app.dock.setIcon(dockIconPath)
  } catch {}
}

let mainWindow: BrowserWindow | null = null
let piBridge: PiSDKBridge | null = null
let initialSessionPath: string | undefined

function createWindow(): void {
  const iconPath = join(__dirname, 'icon.png')
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    backgroundColor: '#ffffff',
    titleBarStyle: 'hiddenInset',
    icon: iconPath,
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

  ipcMain.handle('pi:getAvailableModels', async () => {
    if (!piBridge?.isConnected) return { ok: false, error: 'Pi not connected' }
    try {
      const data = await piBridge.sendRpcCommand({ type: 'get_available_models' })
      return { ok: true, data }
    } catch (err: unknown) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('pi:setModel', async (_event, model: string, provider?: string) => {
    if (!piBridge?.isConnected) return { ok: false, error: 'Pi not connected' }
    try {
      const command: Record<string, unknown> = { type: 'set_model', model }
      if (provider) command.provider = provider
      const data = await piBridge.sendRpcCommand(command)
      return { ok: true, data }
    } catch (err: unknown) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('pi:cycleModel', async (_event, direction?: 'forward' | 'backward') => {
    if (!piBridge?.isConnected) return { ok: false, error: 'Pi not connected' }
    try {
      const data = await piBridge.sendRpcCommand({ type: 'cycle_model', direction: direction ?? 'forward' })
      return { ok: true, data }
    } catch (err: unknown) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('pi:getModelInfo', async () => {
    if (!piBridge?.isConnected) return { ok: false, error: 'Pi not connected' }
    try {
      const data = await piBridge.sendRpcCommand({ type: 'get_state' })
      const state = data as Record<string, unknown>
      return { ok: true, data: { model: state.model ?? null, thinkingLevel: state.thinkingLevel ?? null } }
    } catch (err: unknown) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('pi:getProviderAuthStatus', async () => {
    if (!piBridge?.isConnected) return { ok: false, error: 'Pi not connected' }
    try {
      const data = await piBridge.sendRpcCommand({ type: 'get_provider_auth_status' })
      return { ok: true, data }
    } catch (err: unknown) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('pi:setApiKey', async (_event, provider: string, apiKey: string) => {
    if (!piBridge?.isConnected) return { ok: false, error: 'Pi not connected' }
    try {
      await piBridge.sendRpcCommand({ type: 'set_api_key', provider, apiKey })
      return { ok: true }
    } catch (err: unknown) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('pi:removeAuth', async (_event, provider: string) => {
    if (!piBridge?.isConnected) return { ok: false, error: 'Pi not connected' }
    try {
      await piBridge.sendRpcCommand({ type: 'remove_auth', provider })
      return { ok: true }
    } catch (err: unknown) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('pi:registerCustomProvider', async (_event, provider: string, config: Record<string, unknown>) => {
    if (!piBridge?.isConnected) return { ok: false, error: 'Pi not connected' }
    try {
      await piBridge.sendRpcCommand({ type: 'register_custom_provider', provider, config })
      return { ok: true }
    } catch (err: unknown) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.on('app:openConfigDir', () => {
    const configDir = join(process.env.HOME ?? process.env.USERPROFILE ?? '~', '.pi', 'agent')
    const authPath = join(configDir, 'auth.json')
    if (existsSync(authPath)) {
      shell.showItemInFolder(authPath)
    } else {
      shell.openPath(configDir)
    }
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
        try {
          await piBridge!.sendRpcCommand({ type: 'flush_session' })
        } catch {}
      }
      return { ok: true }
    } catch (err: unknown) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('project:openDirectory', async () => {
    try {
      const win = BrowserWindow.getFocusedWindow()
      const result = await dialog.showOpenDialog(win!, {
        properties: ['openDirectory']
      })
      if (result.canceled || result.filePaths.length === 0) {
        return { ok: false }
      }
      const newCwd = result.filePaths[0]
      try {
        await piBridge?.stop()
      } catch {}
      piBridge = null
      let mainSession = sessionService.findMainSession(newCwd)
      if (mainSession && !mainSession.name) {
        sessionService.nameSession(mainSession.filePath, 'main')
        mainSession = { ...mainSession, name: 'main' }
      }
      initPiBridge(mainSession?.filePath)
      try {
        await piBridge!.start(newCwd, initialSessionPath)
        return { ok: true }
      } catch (err: unknown) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
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
          await piBridge!.sendRpcCommand({ type: 'flush_session' })
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

  ipcMain.handle('session:newSession', async (_event, name: string, parentSessionPath?: string) => {
    try {
      // 1. Tell Pi to create a new session (with parentSession in header)
      const command: Record<string, unknown> = { type: 'new_session' }
      if (parentSessionPath) {
        command.parentSession = parentSessionPath
      }
      await piBridge!.sendRpcCommand(command)

      // 2. Set the session name via Pi RPC (adds session_info entry in memory)
      if (name) {
        try {
          await piBridge!.sendRpcCommand({ type: 'set_session_name', name })
        } catch {}
      }

      // 3. Force-flush the session file to disk.
      //    Pi defers file creation until the first assistant message,
      //    but we need the file now so the sidebar displays correctly.
      //    The flush command also sets Pi's internal 'flushed' flag so
      //    subsequent _persist calls use appendFileSync instead of
      //    openSync('wx') which would fail on an existing file.
      try {
        await piBridge!.sendRpcCommand({ type: 'flush_session' })
      } catch {}

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
        // Deleting the active session: create a new session first, then delete the old one
        await piBridge!.sendRpcCommand({ type: 'new_session' })
        try {
          await piBridge!.sendRpcCommand({ type: 'set_session_name', name: 'main' })
        } catch {}
        try {
          await piBridge!.sendRpcCommand({ type: 'flush_session' })
        } catch {}
        sessionService.deleteSession(sessionPath)
        return { success: true }
      }
    } catch {
      // Pi disconnected — allow delete anyway
    }

    const result = sessionService.deleteSession(sessionPath)
    if (result) {
      return { success: true }
    }
    return { success: false, error: 'Failed to delete session' }
  })

  ipcMain.handle('session:getForkPoints', async (_event, sessionPath: string) => {
    return sessionService.getForkPoints(sessionPath)
  })

  ipcMain.handle('session:setSessionStatus', async (_event, sessionPath: string, status: 'active' | 'completed') => {
    const result = sessionService.setSessionStatus(sessionPath, status)
    if (result) {
      return { success: true }
    }
    return { success: false, error: 'Failed to set session status' }
  })

  ipcMain.handle('session:getMessagesForSession', async (_event, sessionPath: string) => {
    return sessionService.parseSessionMessages(sessionPath)
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

      try {
        await piBridge!.sendRpcCommand({ type: 'flush_session' })
      } catch {}

      sessionService.deleteSession(oldPath)

      return { success: true }
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  const HIDDEN_DIRS = new Set(['node_modules', '.git', 'out', 'dist', '.pi', '.sisyphus', '.claude', '.playwright-cli'])
  const HIDDEN_PREFIXES = new Set(['.'])

  ipcMain.handle('fs:readDirectory', async (_event, dirPath: string) => {
    try {
      if (!existsSync(dirPath)) {
        return { ok: false, error: 'Directory not found' }
      }
      const entries = readdirSync(dirPath)
        .filter((name) => !HIDDEN_DIRS.has(name) && !HIDDEN_PREFIXES.has(name[0]))
        .map((name) => {
          const fullPath = join(dirPath, name)
          try {
            const isDir = statSync(fullPath).isDirectory()
            return { name, path: fullPath, isDirectory: isDir }
          } catch {
            return null
          }
        })
        .filter(Boolean) as Array<{ name: string; path: string; isDirectory: boolean }>

      entries.sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
        return a.name.localeCompare(b.name)
      })

      return { ok: true, entries }
    } catch (err: unknown) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('fs:readFile', async (_event, filePath: string) => {
    try {
      if (!existsSync(filePath)) {
        return { ok: false, error: 'File not found' }
      }
      const stat = statSync(filePath)
      if (stat.isDirectory()) {
        return { ok: false, error: 'Path is a directory' }
      }
      if (stat.size > 2 * 1024 * 1024) {
        return { ok: false, error: 'File too large (max 2MB)' }
      }
      const content = readFileSync(filePath, 'utf-8')
      const name = basename(filePath)
      const ext = extname(filePath).slice(1)
      return { ok: true, data: { content, name, ext, path: filePath } }
    } catch (err: unknown) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('git:status', async () => {
    try {
      const projectPath = process.cwd()
      const git = simpleGit(projectPath)
      const isRepo = await git.checkIsRepo()
      if (!isRepo) return { ok: false, error: 'Not a git repository' }
      const status = await git.status()
      const files: Array<{ path: string; status: string; staged: boolean }> = []
      for (const f of status.staged) {
        files.push({ path: f, status: status.files.find(s => s.path === f)?.index ?? 'M', staged: true })
      }
      for (const f of status.modified) {
        if (!status.staged.includes(f)) {
          files.push({ path: f, status: 'M', staged: false })
        }
      }
      for (const f of status.not_added) {
        files.push({ path: f, status: '?', staged: false })
      }
      for (const f of status.deleted) {
        if (!status.staged.includes(f)) {
          files.push({ path: f, status: 'D', staged: false })
        }
      }
      for (const f of status.created) {
        if (!status.staged.includes(f)) {
          files.push({ path: f, status: 'A', staged: false })
        }
      }
      return {
        ok: true,
        data: {
          branch: status.current ?? '',
          ahead: status.ahead,
          behind: status.behind,
          files,
        },
      }
    } catch (err: unknown) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('git:diff', async (_event, filePath: string, staged?: boolean) => {
    try {
      const projectPath = process.cwd()
      const git = simpleGit(projectPath)
      const diff = staged ? await git.diff(['--cached', filePath]) : await git.diff(['--', filePath])
      return { ok: true, data: diff }
    } catch (err: unknown) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('git:stage', async (_event, filePaths: string[]) => {
    try {
      const projectPath = process.cwd()
      const git = simpleGit(projectPath)
      await git.add(filePaths)
      return { ok: true }
    } catch (err: unknown) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('git:unstage', async (_event, filePaths: string[]) => {
    try {
      const projectPath = process.cwd()
      const git = simpleGit(projectPath)
      await git.reset(['HEAD', '--', ...filePaths])
      return { ok: true }
    } catch (err: unknown) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('git:commit', async (_event, message: string) => {
    try {
      const projectPath = process.cwd()
      const git = simpleGit(projectPath)
      await git.commit(message)
      return { ok: true }
    } catch (err: unknown) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('git:discard', async (_event, filePaths: string[]) => {
    try {
      const projectPath = process.cwd()
      const git = simpleGit(projectPath)
      await git.checkout(['--', ...filePaths])
      return { ok: true }
    } catch (err: unknown) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('skills:list', async () => {
    try {
      const homeDir = process.env.HOME ?? process.env.USERPROFILE ?? ''
      const skillsDirs = [
        join(homeDir, '.pi', 'agent', 'skills'),
        join(homeDir, '.agents', 'skills'),
        join(process.cwd(), '.pi', 'skills'),
        join(process.cwd(), '.agents', 'skills'),
      ]
      const skills: Array<{ name: string; description: string; source: string }> = []
      for (const dir of skillsDirs) {
        if (!existsSync(dir)) continue
        const entries = readdirSync(dir, { withFileTypes: true })
        for (const entry of entries) {
          if (entry.name.startsWith('.')) continue
          const fullPath = join(dir, entry.name)
          let skillFile = ''
          if (entry.isDirectory()) {
            const candidate = join(fullPath, 'SKILL.md')
            if (existsSync(candidate)) skillFile = candidate
          } else if (entry.name === 'SKILL.md') {
            skillFile = fullPath
          }
          if (!skillFile) continue
          try {
            const content = readFileSync(skillFile, 'utf-8')
            const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---/)
            const name = entry.isDirectory() ? entry.name : 'skill'
            let description = ''
            if (fmMatch) {
              const frontmatter = fmMatch[1]
              const nameMatch = frontmatter.match(/^name:\s*(.+)$/m)
              const descMatch = frontmatter.match(/^description:\s*(.+)$/m)
              if (nameMatch) skills.push({ name: nameMatch[1].trim(), description: descMatch?.[1]?.trim() ?? '', source: dirname(fullPath) })
              else skills.push({ name, description: descMatch?.[1]?.trim() ?? '', source: dirname(fullPath) })
            } else {
              skills.push({ name, description: '', source: dirname(fullPath) })
            }
          } catch {}
        }
      }
      const seen = new Set<string>()
      return { ok: true, data: skills.filter(s => { if (seen.has(s.name)) return false; seen.add(s.name); return true }) }
    } catch (err: unknown) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('mcp:list', async () => {
    try {
      const homeDir = process.env.HOME ?? process.env.USERPROFILE ?? ''
      const configPaths = [
        join(homeDir, '.pi', 'agent', 'settings.json'),
        join(process.cwd(), '.pi', 'settings.json'),
      ]
      const servers: Array<{ name: string; command: string; args?: string[]; env?: Record<string, string> }> = []
      const seenMcp = new Set<string>()
      for (const configPath of configPaths) {
        if (!existsSync(configPath)) continue
        try {
          const content = readFileSync(configPath, 'utf-8')
          const config = JSON.parse(content)
          const mcpServers = config.mcpServers ?? config.mcp_servers ?? {}
          if (typeof mcpServers !== 'object') continue
          for (const [name, serverConfig] of Object.entries(mcpServers)) {
            const sc = serverConfig as Record<string, unknown>
            if (seenMcp.has(name)) continue
            seenMcp.add(name)
            servers.push({
              name,
              command: typeof sc.command === 'string' ? sc.command : '',
              args: Array.isArray(sc.args) ? sc.args.map(String) : undefined,
              env: typeof sc.env === 'object' && sc.env !== null ? Object.fromEntries(Object.entries(sc.env as Record<string, unknown>).map(([k, v]) => [k, String(v)])) : undefined,
            })
          }
        } catch {}
      }
      return { ok: true, data: servers }
    } catch (err: unknown) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
}

app.whenReady().then(() => {
  nativeTheme.themeSource = 'light'
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
