import { app, BrowserWindow, ipcMain, nativeTheme, dialog, shell } from 'electron'
import { join, basename, extname, dirname, resolve } from 'path'
import { existsSync, readdirSync, statSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { execFile } from 'child_process'
import { simpleGit, type SimpleGit } from 'simple-git'
import { watch } from 'chokidar'
import { WorkerManager } from './worker-manager'
import * as sessionService from './session-service'
import type { SessionInfo, ForkableMessage, ForkPoint } from '../renderer/src/types/session'

import { DEFAULT_SUMMARY_PROMPT } from '../shared/summary-prompt'

// Override app name & dock icon so macOS shows "Xi" instead of "Electron"
app.setName('Xi')
if (process.platform === 'darwin') {
  try {
    const dockIconPath = join(__dirname, 'icon.png')
    app.dock.setIcon(dockIconPath)
  } catch {}
}

let mainWindow: BrowserWindow | null = null
let workerManager: WorkerManager | null = null
let initialSessionPath: string | undefined

let projectPath = process.cwd()

let _git: SimpleGit | null = null
let _gitAvailable: boolean | null = null

function resetGit(newPath: string): void {
  projectPath = newPath
  _git = null
  _gitAvailable = null
}

function getGit(): SimpleGit {
  if (!_git) {
    _git = simpleGit(projectPath, { binary: 'git' })
  }
  return _git
}

async function checkGitAvailable(): Promise<boolean> {
  if (_gitAvailable !== null) return _gitAvailable
  return new Promise((resolve) => {
    execFile('git', ['--version'], (err: Error | null) => {
      _gitAvailable = !err
      resolve(_gitAvailable)
    })
  })
}

async function withRetry<T>(fn: (git: SimpleGit) => Promise<T>, retries = 2, delayMs = 200): Promise<T> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn(getGit())
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('ENOENT')) {
        _gitAvailable = false
      }
      if (attempt < retries && (msg.includes('EBADF') || msg.includes('ENOENT') || msg.includes('EAGAIN'))) {
        _git = null
        await new Promise(r => setTimeout(r, delayMs * (attempt + 1)))
        continue
      }
      throw err
    }
  }
  throw new Error('unreachable')
}

function createWindow(): void {
  const iconPath = join(__dirname, 'icon.png')
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    backgroundColor: '#16181d',
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

  mainWindow.webContents.on('context-menu', (event) => {
    event.preventDefault()
  })

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== mainWindow?.webContents.getURL()) {
      event.preventDefault()
      shell.openExternal(url)
    }
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

function initWorkerManager(sessionPath?: string): void {
  workerManager = new WorkerManager()
  initialSessionPath = sessionPath

  workerManager.on('event', (data: unknown) => {
    if (typeof data === 'object' && data !== null) {
      const obj = data as Record<string, unknown>
      if (obj.type === 'extension_ui_request') {
        broadcastToRenderers('pi:extensionUiRequest', data)
        return
      }
      if (!obj.sessionPath) {
        const primary = workerManager?.getPrimary()
        if (primary?.sessionPath) obj.sessionPath = primary.sessionPath
      }
    }
    broadcastToRenderers('pi:event', data)
  })

  workerManager.on('response', (data: unknown) => {
    if (typeof data === 'object' && data !== null) {
      const obj = data as Record<string, unknown>
      if (!obj.sessionPath) {
        const primary = workerManager?.getPrimary()
        if (primary?.sessionPath) obj.sessionPath = primary.sessionPath
      }
    }
    broadcastToRenderers('pi:response', data)
  })

  workerManager.on('connected', (info: unknown) => {
    const { role } = info as { role: string; sessionPath: string }
    if (role === 'primary') {
      broadcastToRenderers('pi:stateChanged', { connected: true })
    }
  })

  workerManager.on('disconnected', (info: unknown) => {
    const { role } = info as { role: string; sessionPath: string }
    if (role === 'primary') {
      broadcastToRenderers('pi:stateChanged', { connected: false })
    }
  })

  workerManager.on('error', (err: Error) => {
    console.error('[WorkerManager]', err.message)
  })

  workerManager.on('worker:status', (data: unknown) => {
    broadcastToRenderers('worker:status', data)
  })

  workerManager.on('subagent:run', async (data: unknown) => {
    const msg = data as { toolCallId: string; task: string; parentSessionFile: string }
    const { toolCallId, task, parentSessionFile } = msg
    const cwd = projectPath

    const sessionDir = sessionService.getSessionDir(cwd)
    const subSessionPath = sessionService.createSessionFile(sessionDir, cwd, 'subagent', parentSessionFile)
    sessionService.setSessionOrigin(subSessionPath, 'subagent')
    sessionService.setSubagentMeta(subSessionPath, {
      agentName: 'subagent',
      task,
      mode: 'single',
      runId: toolCallId,
    })

    broadcastToRenderers('subagent:status', {
      type: 'subagent:detected',
      sessionPath: subSessionPath,
      parentSessionPath: parentSessionFile,
      toolCallId,
    })

    try {
      const worker = await workerManager!.getOrCreateSecondary(subSessionPath, cwd)

      const agentEndPromise = new Promise<void>((resolve) => {
        const handler = (eventData: unknown) => {
          const evt = eventData as Record<string, unknown>
          if (evt.type === 'agent_end' && evt.sessionPath === subSessionPath) {
            workerManager?.off('event', handler)
            resolve()
          }
        }
        workerManager?.on('event', handler)
      })

      worker.bridge.sendCommand({ type: 'prompt', message: task })

      await agentEndPromise

      const messages = sessionService.parseSessionMessages(subSessionPath)
      const lastAssistant = [...messages].reverse().find(
        (m) => (m as { role?: string }).role === 'assistant'
      )

      let resultText = '(subagent produced no output)'
      if (lastAssistant) {
        const content = (lastAssistant as { content?: unknown }).content
        if (typeof content === 'string') {
          resultText = content
        } else if (Array.isArray(content)) {
          const parts: string[] = []
          for (const block of content) {
            if (block && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string') {
              parts.push(block.text)
            }
          }
          resultText = parts.join('\n') || resultText
        }
      }

      const primary = workerManager?.getPrimary()
      primary?.bridge.sendCommand({
        type: 'subagent:result',
        toolCallId,
        result: {
          content: [{ type: 'text', text: resultText }],
          details: { sessionPath: subSessionPath, exitStatus: 'success' },
        },
      })
    } catch (err) {
      const primary = workerManager?.getPrimary()
      primary?.bridge.sendCommand({
        type: 'subagent:result',
        toolCallId,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  })
}

function registerIpcHandlers(): void {
  ipcMain.handle('pi:sendCommand', (_event, sessionPath: string | null, command: Record<string, unknown>) => {
    const worker = (sessionPath ? workerManager?.get(sessionPath) : null) ?? workerManager?.getPrimary()
    if (!worker?.bridge.isConnected) return { ok: false, error: 'Worker not connected' }
    worker.bridge.sendCommand(command)
    return { ok: true }
  })

  ipcMain.handle('pi:sendExtensionUIResponse', (_event, sessionPath: string | null, response: Record<string, unknown>) => {
    const worker = (sessionPath ? workerManager?.get(sessionPath) : null) ?? workerManager?.getPrimary()
    if (!worker?.bridge.isConnected) return { ok: false, error: 'Worker not connected' }
    worker.bridge.sendExtensionUIResponse(response)
    return { ok: true }
  })

  ipcMain.handle('pi:getState', () => {
    return { connected: workerManager?.getPrimary()?.bridge.isConnected ?? false }
  })

  ipcMain.handle('pi:getAvailableModels', async (_event, _sessionPath: string | null) => {
    // Model registry is global, always query primary worker
    const worker = workerManager?.getPrimary()
    if (!worker?.bridge.isConnected) return { ok: false, error: 'Worker not connected' }
    try {
      const data = await worker.bridge.sendRpcCommand({ type: 'get_available_models' }) as { models?: Array<Record<string, unknown>> }
      if (data.models) {
        let authStatus: Record<string, { configured: boolean; source?: string }> = {}
        try {
          const authData = await worker.bridge.sendRpcCommand({ type: 'get_provider_auth_status' }) as Record<string, { configured: boolean; source?: string }>
          if (authData) authStatus = authData
        } catch {}
        const xiAuthPath = join(process.env.HOME ?? process.env.USERPROFILE ?? '~', '.xi', 'auth.json')
        let xiAuth: Record<string, unknown> = {}
        try { if (existsSync(xiAuthPath)) xiAuth = JSON.parse(readFileSync(xiAuthPath, 'utf-8')) } catch {}
        for (const m of data.models) {
          const provider = m.provider as string
          if (authStatus[provider]?.configured) {
            m.hasAuth = true
          } else if (xiAuth[provider]?.key) {
            m.hasAuth = true
          }
        }
      }
      return { ok: true, data }
    } catch (err: unknown) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('pi:setModel', async (_event, sessionPath: string | null, model: string, provider?: string) => {
    const worker = (sessionPath ? workerManager?.get(sessionPath) : null) ?? workerManager?.getPrimary()
    if (!worker?.bridge.isConnected) return { ok: false, error: 'Worker not connected' }
    try {
      const command: Record<string, unknown> = { type: 'set_model', model }
      if (provider) command.provider = provider
      const data = await worker.bridge.sendRpcCommand(command)
      return { ok: true, data }
    } catch (err: unknown) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('pi:cycleModel', async (_event, sessionPath: string | null, direction?: 'forward' | 'backward') => {
    const worker = (sessionPath ? workerManager?.get(sessionPath) : null) ?? workerManager?.getPrimary()
    if (!worker?.bridge.isConnected) return { ok: false, error: 'Worker not connected' }
    try {
      const data = await worker.bridge.sendRpcCommand({ type: 'cycle_model', direction: direction ?? 'forward' })
      return { ok: true, data }
    } catch (err: unknown) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('pi:getModelInfo', async (_event, sessionPath: string | null) => {
    const worker = (sessionPath ? workerManager?.get(sessionPath) : null) ?? workerManager?.getPrimary()
    if (!worker?.bridge.isConnected) return { ok: false, error: 'Worker not connected' }
    try {
      const data = await worker.bridge.sendRpcCommand({ type: 'get_state' })
      const state = data as Record<string, unknown>
      return { ok: true, data: { model: state.model ?? null, thinkingLevel: state.thinkingLevel ?? null } }
    } catch (err: unknown) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('pi:getProviderAuthStatus', async (_event, _sessionPath: string | null) => {
    const primary = workerManager?.getPrimary()
    if (!primary?.bridge.isConnected) return { ok: false, error: 'Pi not connected' }
    try {
      const data = await primary.bridge.sendRpcCommand({ type: 'get_provider_auth_status' })
      return { ok: true, data }
    } catch (err: unknown) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('pi:setApiKey', async (_event, _sessionPath: string | null, provider: string, apiKey: string) => {
    // Broadcast to ALL workers so every session's registry is updated
    const workers = workerManager?.getAllWorkers() ?? []
    let anyOk = false
    for (const worker of workers) {
      if (!worker.bridge.isConnected) continue
      try {
        await worker.bridge.sendRpcCommand({ type: 'set_api_key', provider, apiKey })
        anyOk = true
      } catch {}
    }
    return anyOk ? { ok: true } : { ok: false, error: 'No connected workers' }
  })

  ipcMain.handle('pi:removeAuth', async (_event, _sessionPath: string | null, provider: string) => {
    // Broadcast to ALL workers so every session's registry is updated
    const workers = workerManager?.getAllWorkers() ?? []
    let anyOk = false
    for (const worker of workers) {
      if (!worker.bridge.isConnected) continue
      try {
        await worker.bridge.sendRpcCommand({ type: 'remove_auth', provider })
        anyOk = true
      } catch {}
    }
    return anyOk ? { ok: true } : { ok: false, error: 'No connected workers' }
  })

  ipcMain.handle('pi:registerCustomProvider', async (_event, _sessionPath: string | null, provider: string, config: Record<string, unknown>) => {
    // Broadcast to ALL workers so every session's registry gets the provider
    const workers = workerManager?.getAllWorkers() ?? []
    let anyOk = false
    for (const worker of workers) {
      if (!worker.bridge.isConnected) continue
      try {
        await worker.bridge.sendRpcCommand({ type: 'register_custom_provider', provider, config })
        anyOk = true
      } catch (err: unknown) {
        // Log but continue — other workers may succeed
      }
    }
    if (!anyOk) return { ok: false, error: 'Pi not connected' }
    // registerProvider is memory-only; write models.json so Pi SDK reloads on restart
    // Pi SDK validateConfig requires apiKey for non-built-in providers with custom models
    try {
      const agentDir = process.env.PI_CODING_AGENT_DIR || join(process.env.HOME ?? process.env.USERPROFILE ?? '~', '.xi')
      if (!existsSync(agentDir)) mkdirSync(agentDir, { recursive: true })
      const modelsPath = join(agentDir, 'models.json')
      let existing: Record<string, unknown> = {}
      if (existsSync(modelsPath)) {
        try { existing = JSON.parse(readFileSync(modelsPath, 'utf-8')) } catch {}
      }
      const providers = (existing.providers ?? {}) as Record<string, Record<string, unknown>>
      providers[provider] = config
      existing.providers = providers
      writeFileSync(modelsPath, JSON.stringify(existing, null, 2))
    } catch {}
    return { ok: true }
  })

  ipcMain.handle('worker:ensureReady', async (_event, sessionPath: string) => {
    const primary = workerManager?.getPrimary()
    if (primary && primary.sessionPath === sessionPath && primary.status === 'connected') {
      return { ok: true, status: 'connected' }
    }

    const existing = workerManager?.get(sessionPath)
    if (existing && existing.status === 'connected') return { ok: true, status: 'connected' }
    if (existing && existing.status === 'starting') return { ok: true, status: 'starting' }
    if (existing && existing.status === 'error') {
      if (existing.role === 'secondary') {
        await workerManager!.disposeSecondary(sessionPath)
      }
    }

    try {
      const state = await workerManager!.getOrCreateSecondary(sessionPath, process.cwd())
      return { ok: true, status: state.status }
    } catch (err: unknown) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('worker:getStatus', () => {
    const workers = workerManager?.getAllWorkers() ?? []
    return workers.map(w => ({
      sessionPath: w.sessionPath,
      role: w.role,
      status: w.status,
      isStreaming: w.isStreaming,
    }))
  })

  ipcMain.handle('worker:setIdleTimeout', (_event, minutes: number) => {
    if (!workerManager) return { ok: false, error: 'WorkerManager not initialized' }
    workerManager.setIdleTimeout(minutes * 60 * 1000)
    return { ok: true }
  })

  ipcMain.handle('worker:getIdleTimeout', () => {
    if (!workerManager) return { ok: true, minutes: 5 }
    return { ok: true, minutes: Math.round(workerManager.idleTimeoutMs / 60 / 1000) }
  })

  ipcMain.handle('worker:setMaxSecondaries', (_event, n: number) => {
    if (!workerManager) return { ok: false, error: 'WorkerManager not initialized' }
    workerManager.setMaxSecondaries(n)
    return { ok: true }
  })

  ipcMain.handle('worker:getMaxSecondaries', () => {
    if (!workerManager) return { ok: true, maxSecondaries: 8 }
    return { ok: true, maxSecondaries: workerManager.maxSecondaries }
  })

  ipcMain.handle('worker:dispose', async (_event, sessionPath: string) => {
    const worker = workerManager?.get(sessionPath)
    if (!worker) return { ok: true }
    if (worker.role === 'primary') return { ok: false, error: 'Cannot dispose primary worker' }
    try {
      await workerManager!.disposeSecondary(sessionPath)
      return { ok: true }
    } catch (err: unknown) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('provider:listCustomProviders', async () => {
    try {
      const agentDir = process.env.PI_CODING_AGENT_DIR || join(process.env.HOME ?? process.env.USERPROFILE ?? '~', '.xi')
      const modelsPath = join(agentDir, 'models.json')
      if (!existsSync(modelsPath)) return { ok: true, providers: {} }
      const data = JSON.parse(readFileSync(modelsPath, 'utf-8'))
      const providers: Record<string, { baseUrl: string; name?: string }> = {}
      if (data.providers) {
        for (const [id, config] of Object.entries(data.providers as Record<string, Record<string, unknown>>)) {
          if (config.baseUrl) {
            providers[id] = { baseUrl: config.baseUrl as string, name: config.name as string | undefined }
          }
        }
      }
      return { ok: true, providers }
    } catch {
      return { ok: true, providers: {} }
    }
  })

  ipcMain.handle('provider:getConfig', async (_event, provider: string) => {
    try {
      const agentDir = process.env.PI_CODING_AGENT_DIR || join(process.env.HOME ?? process.env.USERPROFILE ?? '~', '.xi')
      const homeDir = process.env.HOME ?? process.env.USERPROFILE ?? ''
      const configDirs = [agentDir, join(homeDir, '.pi', 'agent')]
      for (const configDir of configDirs) {
        for (const configFile of ['models.json', 'settings.json']) {
          const configPath = join(configDir, configFile)
          if (existsSync(configPath)) {
            const data = JSON.parse(readFileSync(configPath, 'utf-8'))
            const providerData = data.providers?.[provider]
            if (providerData) return { ok: true, config: providerData }
          }
        }
      }
      return { ok: false, error: 'Provider not found' }
    } catch (err: unknown) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('provider:test', async (_event, _sessionPath: string | null, provider: string, overrides?: { baseUrl?: string; apiKey?: string }) => {
    try {
      const providerBaseUrls: Record<string, string> = {
        anthropic: 'https://api.anthropic.com',
        openai: 'https://api.openai.com',
        google: 'https://generativelanguage.googleapis.com',
        deepseek: 'https://api.deepseek.com',
        openrouter: 'https://openrouter.ai',
        groq: 'https://api.groq.com',
        xai: 'https://api.x.ai',
        mistral: 'https://api.mistral.ai',
      }

      const agentDir = process.env.PI_CODING_AGENT_DIR ?? join(process.env.HOME ?? process.env.USERPROFILE ?? '~', '.xi')
      const homeDir = process.env.HOME ?? process.env.USERPROFILE ?? '~'

      let baseUrl = overrides?.baseUrl ?? providerBaseUrls[provider]
      if (!baseUrl) {
        try {
          for (const configFile of ['models.json', 'settings.json']) {
            const configPath = join(agentDir, configFile)
            if (existsSync(configPath)) {
              const data = JSON.parse(readFileSync(configPath, 'utf-8'))
              const custom = data.providers?.[provider]
              if (custom?.baseUrl) { baseUrl = custom.baseUrl; break }
            }
          }
        } catch {}
      }
      if (!baseUrl) return { ok: false, error: 'Unknown provider' }

      let apiKey = overrides?.apiKey ?? ''
      if (!apiKey) {
        const envMap: Record<string, string> = {
          anthropic: 'ANTHROPIC_API_KEY',
          openai: 'OPENAI_API_KEY',
          google: 'GOOGLE_API_KEY',
          deepseek: 'DEEPSEEK_API_KEY',
          openrouter: 'OPENROUTER_API_KEY',
          groq: 'GROQ_API_KEY',
          xai: 'XAI_API_KEY',
          mistral: 'MISTRAL_API_KEY',
        }
        const envKey = envMap[provider]
        if (envKey && process.env[envKey]) {
          apiKey = process.env[envKey]!
        }
      }
      if (!apiKey && workerManager?.getPrimary()?.bridge.isConnected) {
        try {
          const authData = await Promise.race([
            workerManager.getPrimary()!.bridge.sendRpcCommand({ type: 'get_provider_auth_status' }),
            new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000)),
          ]) as Record<string, unknown> | null
          if (authData) {
            const authStatus = authData as Record<string, { configured: boolean; source?: string }>
            if (authStatus?.[provider]?.configured) {
              try {
                const keyData = await Promise.race([
                  workerManager.getPrimary()!.bridge.sendRpcCommand({ type: 'get_api_key', provider }),
                  new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000)),
                ]) as Record<string, unknown> | null
                if (keyData && typeof keyData.apiKey === 'string') apiKey = keyData.apiKey
              } catch {}
            }
          }
        } catch {}
      }
      if (!apiKey) {
        try {
          for (const dir of [agentDir, join(homeDir, '.xi')]) {
            const authPath = join(dir, 'auth.json')
            if (existsSync(authPath)) {
              const data = JSON.parse(readFileSync(authPath, 'utf-8'))
              if (data[provider]?.key) { apiKey = data[provider].key; break }
            }
          }
        } catch {}
      }
      if (!apiKey) {
        try {
          const configDir = join(homeDir, '.pi', 'agent')
          for (const configFile of ['auth.json', 'models.json']) {
            const configPath = join(configDir, configFile)
            if (existsSync(configPath)) {
              const data = JSON.parse(readFileSync(configPath, 'utf-8'))
              const providerData = data[provider] ?? data.providers?.[provider]
              if (providerData?.apiKey) { apiKey = providerData.apiKey; break }
              if (providerData?.key) { apiKey = providerData.key; break }
            }
          }
        } catch {}
      }
      if (!apiKey) return { ok: false, error: 'No API key configured' }

      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 10_000)

      let url: string
      let headers: Record<string, string>
      const base = baseUrl.endsWith('/v1') || baseUrl.endsWith('/v1/') ? baseUrl.replace(/\/v1\/?$/, '') : baseUrl
      if (provider === 'anthropic') {
        url = `${base}/v1/models`
        headers = { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }
      } else if (provider === 'google') {
        url = `${base}/v1beta/models?key=${apiKey}`
        headers = {}
      } else {
        headers = { 'Authorization': `Bearer ${apiKey}` }
        url = `${base}/v1/models`
      }

      const start = Date.now()
      const response = await fetch(url, { signal: controller.signal, headers })
      clearTimeout(timeout)

      if (response.ok) {
        return { ok: true, latencyMs: Date.now() - start }
      }
      if (response.status === 401 || response.status === 403) {
        return { ok: false, error: 'Invalid API key' }
      }
      return { ok: false, error: `HTTP ${response.status}` }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        return { ok: false, error: 'Connection timed out' }
      }
      if (err instanceof TypeError && err.cause instanceof Error) {
        const code = (err.cause as NodeJS.ErrnoException).code
        if (code === 'ECONNREFUSED' || code === 'ENOTFOUND') {
          return { ok: false, error: 'Cannot reach server' }
        }
      }
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('provider:deleteCustomProvider', async (_event, provider: string) => {
    // 1. Check if currently using this provider → fallback
    const primary = workerManager?.getPrimary()
    if (primary?.bridge.isConnected) {
      try {
        const stateData = (await primary.bridge.sendRpcCommand({ type: 'get_state' })) as Record<string, unknown>
        const currentModel = stateData.model as Record<string, unknown> | undefined | null
        if (currentModel && currentModel.provider === provider) {
          // Find a fallback model from a different provider
          const modelsData = await primary.bridge.sendRpcCommand({ type: 'get_available_models' }) as { models?: Array<Record<string, unknown>> }
          const fallback = modelsData.models?.find(m => m.provider !== provider && m.hasAuth)
          if (fallback) {
            await primary.bridge.sendRpcCommand({ type: 'set_model', model: fallback.id, provider: fallback.provider as string })
          }
        }
      } catch {}
    }

    // 2. Remove from models.json FIRST (before broadcast, so refresh() loads updated data)
    const agentDir = process.env.PI_CODING_AGENT_DIR || join(process.env.HOME ?? process.env.USERPROFILE ?? '~', '.xi')
    const modelsPath = join(agentDir, 'models.json')
    if (existsSync(modelsPath)) {
      try {
        const data = JSON.parse(readFileSync(modelsPath, 'utf-8'))
        if (data.providers && data.providers[provider]) {
          delete data.providers[provider]
          writeFileSync(modelsPath, JSON.stringify(data, null, 2))
        }
      } catch {}
    }

    // 3. Clear credentials from auth.json
    const authPath = join(agentDir, 'auth.json')
    if (existsSync(authPath)) {
      try {
        const authData = JSON.parse(readFileSync(authPath, 'utf-8'))
        if (authData[provider]) {
          delete authData[provider]
          writeFileSync(authPath, JSON.stringify(authData, null, 2))
        }
      } catch {}
    }

    // 4. Broadcast: unregister from all workers (after disk is updated, so refresh() picks up the change)
    const workers = workerManager?.getAllWorkers() ?? []
    for (const worker of workers) {
      if (!worker.bridge.isConnected) continue
      try {
        await worker.bridge.sendRpcCommand({ type: 'unregister_custom_provider', provider })
      } catch {}
    }

    return { ok: true }
  })

  ipcMain.handle('provider:removeModel', async (_event, provider: string, modelId: string) => {
    // 1. Check if currently using this model → fallback
    const primary = workerManager?.getPrimary()
    if (primary?.bridge.isConnected) {
      try {
        const stateData = (await primary.bridge.sendRpcCommand({ type: 'get_state' })) as Record<string, unknown>
        const currentModel = stateData.model as Record<string, unknown> | undefined | null
        if (currentModel && currentModel.id === modelId && currentModel.provider === provider) {
          const modelsData = await primary.bridge.sendRpcCommand({ type: 'get_available_models' }) as { models?: Array<Record<string, unknown>> }
          const sameProviderFallback = modelsData.models?.find(m => m.provider === provider && m.id !== modelId && m.hasAuth)
          const anyFallback = sameProviderFallback ?? modelsData.models?.find(m => m.provider !== provider && m.hasAuth)
          if (anyFallback) {
            await primary.bridge.sendRpcCommand({ type: 'set_model', model: anyFallback.id, provider: anyFallback.provider as string })
          }
        }
      } catch {}
    }

    // 2. Remove model from models.json
    const agentDir = process.env.PI_CODING_AGENT_DIR || join(process.env.HOME ?? process.env.USERPROFILE ?? '~', '.xi')
    const modelsPath = join(agentDir, 'models.json')
    let updatedConfig: Record<string, unknown> | null = null
    let hasRemainingModels = false
    if (existsSync(modelsPath)) {
      try {
        const data = JSON.parse(readFileSync(modelsPath, 'utf-8'))
        if (data.providers?.[provider]?.models) {
          const models = data.providers[provider].models as Array<Record<string, unknown>>
          const filtered = models.filter(m => m.id !== modelId)
          if (filtered.length === 0) {
            // No models left → delete entire provider
            delete data.providers[provider]
          } else {
            data.providers[provider].models = filtered
            updatedConfig = data.providers[provider] as Record<string, unknown>
            hasRemainingModels = true
          }
          writeFileSync(modelsPath, JSON.stringify(data, null, 2))
        }
      } catch {}
    }

    // 3. Broadcast: update all workers
    const workers = workerManager?.getAllWorkers() ?? []
    for (const worker of workers) {
      if (!worker.bridge.isConnected) continue
      try {
        if (hasRemainingModels && updatedConfig) {
          // Re-register with updated config (fewer models)
          await worker.bridge.sendRpcCommand({ type: 'register_custom_provider', provider, config: updatedConfig })
        } else {
          // No models left → unregister entire provider
          await worker.bridge.sendRpcCommand({ type: 'unregister_custom_provider', provider })
        }
      } catch {}
    }

    return { ok: true }
  })

  ipcMain.on('app:openConfigDir', () => {
    const configDir = join(process.env.HOME ?? process.env.USERPROFILE ?? '~', '.xi')
    if (!existsSync(configDir)) {
      mkdirSync(configDir, { recursive: true })
    }
    const authPath = join(configDir, 'auth.json')
    if (existsSync(authPath)) {
      shell.showItemInFolder(authPath)
    } else {
      shell.openPath(configDir)
    }
  })

  ipcMain.on('app:openExternal', (_event, url: string) => {
    shell.openExternal(url)
  })

  ipcMain.on('app:showItemInFolder', (_event, fullPath: string) => {
    shell.showItemInFolder(fullPath)
  })

  ipcMain.on('app:copyToClipboard', (_event, text: string) => {
    const { clipboard } = require('electron')
    clipboard.writeText(text)
  })

  ipcMain.handle('app:getProjectPath', () => process.cwd())

  ipcMain.handle('app:getRecentProjects', () => {
    try {
      const recentProjectsFile = join(app.getPath('userData'), 'recent-projects.json')
      if (!existsSync(recentProjectsFile)) return []
      const data = JSON.parse(readFileSync(recentProjectsFile, 'utf-8')) as { recentProjects: Array<{ path: string; name: string; lastOpened: string }> }
      return (data.recentProjects ?? []).filter(p => existsSync(p.path))
    } catch { return [] }
  })

  ipcMain.handle('app:clearRecentProjects', () => {
    try {
      const recentProjectsFile = join(app.getPath('userData'), 'recent-projects.json')
      if (existsSync(recentProjectsFile)) writeFileSync(recentProjectsFile, JSON.stringify({ recentProjects: [] }, null, 2))
    } catch {}
  })

  ipcMain.handle('pi:getPromptSnapshot', async (_event, sessionPath: string | null, messageTimestamp: number) => {
    const worker = (sessionPath ? workerManager?.get(sessionPath) : null) ?? workerManager?.getPrimary()
    if (!worker?.bridge.isConnected) return { ok: false, error: 'Worker not connected' }
    try {
      const data = await worker.bridge.sendRpcCommand({ type: 'get_prompt_snapshot', messageTimestamp })
      return { ok: true, data }
    } catch (err: unknown) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('pi:setCaptureEnabled', async (_event, _sessionPath: string | null, enabled: boolean) => {
    // 1. Persist to settings.json (source of truth for worker bootstrap)
    try {
      const homeDir = process.env.HOME ?? process.env.USERPROFILE ?? ''
      const agentDir = process.env.PI_CODING_AGENT_DIR || join(homeDir, '.xi')
      const settingsPath = join(agentDir, 'settings.json')
      let settings: Record<string, unknown> = {}
      if (existsSync(settingsPath)) {
        try {
          const content = readFileSync(settingsPath, 'utf-8')
          settings = JSON.parse(content)
        } catch {}
      }
      settings.promptCaptureEnabled = enabled
      writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n')
    } catch (err: unknown) {
      console.error('[setCaptureEnabled] Failed to persist to settings.json:', err instanceof Error ? err.message : String(err))
    }

    // 2. Broadcast to all connected workers
    const workers = workerManager?.getAllWorkers() ?? []
    let lastResult: { ok: boolean; data?: unknown; error?: string } = { ok: false, error: 'No workers' }
    for (const worker of workers) {
      if (!worker.bridge.isConnected) continue
      try {
        const data = await worker.bridge.sendRpcCommand({ type: 'set_capture_enabled', enabled })
        lastResult = { ok: true, data }
      } catch (err: unknown) {
        lastResult = { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    }
    return lastResult
  })

  ipcMain.handle('pi:clearSnapshots', async (_event, sessionPath: string | null) => {
    const worker = (sessionPath ? workerManager?.get(sessionPath) : null) ?? workerManager?.getPrimary()
    if (!worker?.bridge.isConnected) return { ok: false, error: 'Worker not connected' }
    try {
      const data = await worker.bridge.sendRpcCommand({ type: 'clear_snapshots' })
      return { ok: true, data }
    } catch (err: unknown) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('pi:getCaptureStatus', async (_event, sessionPath: string | null) => {
    const worker = (sessionPath ? workerManager?.get(sessionPath) : null) ?? workerManager?.getPrimary()
    if (!worker?.bridge.isConnected) return { ok: false, error: 'Worker not connected' }
    try {
      const data = await worker.bridge.sendRpcCommand({ type: 'get_capture_status' })
      return { ok: true, data }
    } catch (err: unknown) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('pi:start', async () => {
    if (!workerManager) {
      let mainSession = sessionService.findMainSession(process.cwd())
      if (mainSession && !mainSession.name) {
        sessionService.nameSession(mainSession.filePath, 'main')
        mainSession = { ...mainSession, name: 'main' }
      }
      initWorkerManager(mainSession?.filePath)
    }
    try {
      await workerManager!.initPrimary(process.cwd(), initialSessionPath)
      try {
        const state = (await workerManager!.getPrimary()!.bridge.sendRpcCommand({ type: 'get_state' })) as Record<string, unknown>
        const sp = typeof state.sessionFile === 'string' ? state.sessionFile : null
        if (sp) {
          const primary = workerManager!.getPrimary()!
          if (!primary.sessionPath) primary.sessionPath = sp
          sessionService.nameSession(sp, 'main')
          sessionService.flushPendingName(sp)
        }
      } catch {}
      const mainSession = sessionService.findMainSession(process.cwd())
      if (!mainSession || !mainSession.name) {
        try {
          await workerManager!.getPrimary()!.bridge.sendRpcCommand({ type: 'set_session_name', name: 'main' })
        } catch {}
        try {
          await workerManager!.getPrimary()!.bridge.sendRpcCommand({ type: 'flush_session' })
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
      process.chdir(newCwd)
      resetGit(newCwd)
      sessionService.clearPendingNames()
      try {
        await workerManager?.disposeAll()
      } catch {}
      workerManager = null
      let mainSession = sessionService.findMainSession(newCwd)
      if (mainSession && !mainSession.name) {
        sessionService.nameSession(mainSession.filePath, 'main')
        mainSession = { ...mainSession, name: 'main' }
      }
      initWorkerManager(mainSession?.filePath)
      try {
        await workerManager!.initPrimary(newCwd, initialSessionPath)
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
      await workerManager?.disposeAll()
      return { ok: true }
    } catch (err: unknown) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('session:listSessions', async () => {
    let currentPath: string | undefined
    try {
      const primary = workerManager?.getPrimary()
      if (primary?.bridge.isConnected) {
        const data = (await primary.bridge.sendRpcCommand({ type: 'get_state' })) as Record<string, unknown>
        if (typeof data.sessionFile === 'string') currentPath = data.sessionFile
      }
    } catch {
      currentPath = undefined
    }
    return sessionService.listSessions(currentPath)
  })

  ipcMain.handle('session:getForkMessages', async (_event, sessionPath: string | null) => {
    try {
      const worker = (sessionPath ? workerManager?.get(sessionPath) : null) ?? workerManager?.getPrimary()
      if (!worker?.bridge.isConnected) return []
      const data = (await worker.bridge.sendRpcCommand({ type: 'get_fork_messages' })) as {
        messages?: ForkableMessage[]
      }
      return data.messages ?? []
    } catch {
      return []
    }
  })

  ipcMain.handle('session:forkAtEntry', async (_event, sessionPath: string | null, entryId: string, name?: string) => {
    const worker = (sessionPath ? workerManager?.get(sessionPath) : null) ?? workerManager?.getPrimary()
    if (!worker?.bridge.isConnected) {
      return { success: false, error: 'Worker not connected' }
    }

    let parentPath: string | null = null
    try {
      const preState = (await worker.bridge.sendRpcCommand({ type: 'get_state' })) as Record<string, unknown>
      parentPath = typeof preState.sessionFile === 'string' ? preState.sessionFile : null
    } catch {}

    try {
      const data = (await worker.bridge.sendRpcCommand({ type: 'fork', entryId })) as Record<string, unknown>

      if (name) {
        try {
          await worker.bridge.sendRpcCommand({ type: 'set_session_name', name })
        } catch {}
        try {
          await worker.bridge.sendRpcCommand({ type: 'flush_session' })
        } catch {}
      }

      let forkSessionPath: string | null = null
      try {
        const postState = (await worker.bridge.sendRpcCommand({ type: 'get_state' })) as Record<string, unknown>
        const sp = typeof postState.sessionFile === 'string' ? postState.sessionFile : null
        if (sp) {
          forkSessionPath = sp
          if (name) {
            sessionService.nameSession(sp, name)
            sessionService.flushPendingName(sp)
          }
        }
      } catch {}

      if (worker.sessionPath && forkSessionPath !== worker.sessionPath) {
        try {
          await worker.bridge.sendRpcCommand({ type: 'switch_session', sessionPath: worker.sessionPath })
        } catch {}
      }

      if (parentPath) {
        sessionService.addForkPoint(parentPath, entryId, name ?? '')
      }

      return { success: true, text: typeof data.text === 'string' ? data.text : undefined, sessionPath: forkSessionPath }
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('session:switchSession', async (_event, sessionPath: string) => {
    const primary = workerManager?.getPrimary()
    if (!primary?.bridge.isConnected) {
      return { success: false, error: 'Pi not connected' }
    }
    try {
      await primary.bridge.sendRpcCommand({ type: 'switch_session', sessionPath })
      return { success: true }
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('session:newSession', async (_event, _sessionPath: string | null, name: string, parentSessionPath?: string) => {
    const cwd = process.cwd()
    const sessionDir = sessionService.getSessionDir(cwd)
    try {
      const sessionPath = sessionService.createSessionFile(sessionDir, cwd, name, parentSessionPath || undefined)
      return { success: true, sessionPath }
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('session:renameSession', async (_event, sessionPath: string | null, name: string) => {
    // If sessionPath is provided, write the name directly to that session's file
    if (sessionPath) {
      sessionService.nameSession(sessionPath, name)

      // If that session is also the active one, update Pi's runtime state
      const primary = workerManager?.getPrimary()
      if (primary?.bridge.isConnected) {
        try {
          const data = (await primary.bridge.sendRpcCommand({ type: 'get_state' })) as Record<string, unknown>
          if (data.sessionFile === sessionPath) {
            await primary.bridge.sendRpcCommand({ type: 'set_session_name', name })
          }
        } catch {}
      }
    } else {
      // Fallback: rename current session via Pi worker
      const worker = workerManager?.getPrimary()
      if (worker?.bridge.isConnected) {
        try {
          await worker.bridge.sendRpcCommand({ type: 'set_session_name', name })
        } catch {}

        try {
          const data = (await worker.bridge.sendRpcCommand({ type: 'get_state' })) as Record<string, unknown>
          const currentPath = typeof data.sessionFile === 'string' ? data.sessionFile : null
          if (currentPath) {
            sessionService.nameSession(currentPath, name)
          }
        } catch {}
      }
    }

    return { success: true }
  })

  ipcMain.handle('session:getCurrentSession', async () => {
    try {
      const primary = workerManager?.getPrimary()
      if (!primary?.bridge.isConnected) return null
      const data = (await primary.bridge.sendRpcCommand({ type: 'get_state' })) as Record<string, unknown>
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
      const primary = workerManager?.getPrimary()
      if (primary?.bridge.isConnected) {
        const data = (await primary.bridge.sendRpcCommand({ type: 'get_state' })) as Record<string, unknown>
        if (typeof data.sessionFile === 'string') currentPath = data.sessionFile
      }
    } catch {
      currentPath = undefined
    }
    return sessionService.listSessions(currentPath)
  })

  ipcMain.handle('session:getMessages', async (_event, sessionPath: string | null) => {
    try {
      const worker = (sessionPath ? workerManager?.get(sessionPath) : null) ?? workerManager?.getPrimary()
      if (!worker?.bridge.isConnected) return []
      const data = (await worker.bridge.sendRpcCommand({ type: 'get_messages' })) as { messages?: unknown[] }
      return data.messages ?? []
    } catch {
      return []
    }
  })

  ipcMain.handle('session:deleteSession', async (_event, sessionPath: string) => {
    const existing = workerManager?.get(sessionPath)
    if (existing && existing.role === 'secondary') {
      try {
        await workerManager!.disposeSecondary(sessionPath)
      } catch {}
    }

    const primary = workerManager?.getPrimary()
    if (primary?.bridge.isConnected) {
      try {
        const stateData = (await primary.bridge.sendRpcCommand({ type: 'get_state' })) as Record<string, unknown>
        const currentPath = typeof stateData.sessionFile === 'string' ? stateData.sessionFile : null

        if (currentPath === sessionPath) {
          await primary.bridge.sendRpcCommand({ type: 'new_session' })
          try {
            await primary.bridge.sendRpcCommand({ type: 'set_session_name', name: 'main' })
          } catch {}
          try {
            await primary.bridge.sendRpcCommand({ type: 'flush_session' })
          } catch {}
          sessionService.deleteSession(sessionPath)
          return { success: true }
        }
      } catch {
        // Pi disconnected — allow delete anyway
      }
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
      // Auto-trigger summary generation when marking as completed and no summary exists
      if (status === 'completed') {
        try {
          const info = sessionService.parseSessionFile(sessionPath)
          if (info && !info.summary) {
            const worker = workerManager?.get(sessionPath) ?? workerManager?.getPrimary()
            if (worker?.bridge.isConnected) {
              // Fire-and-forget: send summary prompt without awaiting
              worker.bridge.sendRpcCommand({
                type: 'prompt',
                message: DEFAULT_SUMMARY_PROMPT,
              }).catch(() => {
                // Silently ignore — user can manually /summary later
              })
              // Notify frontend that a summary prompt was auto-triggered
              try {
                if (mainWindow && !mainWindow.isDestroyed()) {
                  mainWindow.webContents.send('session:summaryAutoTriggered', sessionPath)
                }
              } catch {}
            }
          }
        } catch {
          // Silently ignore — auto-trigger is best-effort
        }
      }
      return { success: true }
    }
    return { success: false, error: 'Failed to set session status' }
  })

  ipcMain.handle('session:setSessionSummary', async (_event, sessionPath: string, summary: string) => {
    const result = sessionService.setSessionSummary(sessionPath, summary)
    if (result) {
      return { success: true }
    }
    return { success: false, error: 'Failed to set session summary' }
  })

  ipcMain.handle('session:reparentSession', async (_event, sessionPath: string, newParentPath: string | null) => {
    // Get all sessions for validation
    const result = sessionService.listSessions()
    const allSessions = result.projects.flatMap(p => p.allSessions)

    // Cannot reparent the main session
    const target = allSessions.find(s => s.filePath === sessionPath)
    if (target?.isMain) {
      return { success: false, error: 'Cannot reparent the main session' }
    }

    // Cycle detection
    if (newParentPath && sessionService.wouldCreateCycle(sessionPath, newParentPath, allSessions)) {
      return { success: false, error: 'Cannot create a cycle in the session tree' }
    }

    const ok = sessionService.reparentSession(sessionPath, newParentPath)
    if (ok) {
      return { success: true }
    }
    return { success: false, error: 'Failed to reparent session' }
  })

  ipcMain.handle('session:getMessagesForSession', async (_event, sessionPath: string) => {
    return sessionService.parseSessionMessages(sessionPath)
  })

  ipcMain.handle('session:clearSession', async (_event, sessionPath: string | null) => {
    try {
      const worker = (sessionPath ? workerManager?.get(sessionPath) : null) ?? workerManager?.getPrimary()
      if (!worker?.bridge.isConnected) {
        return { success: false, error: 'Worker not connected' }
      }

      const stateData = (await worker.bridge.sendRpcCommand({ type: 'get_state' })) as Record<string, unknown>
      const oldPath = typeof stateData.sessionFile === 'string' ? stateData.sessionFile : null
      const sessionName = typeof stateData.sessionName === 'string' ? stateData.sessionName : null

      if (!oldPath) {
        return { success: false, error: 'No active session to clear' }
      }

      await worker.bridge.sendRpcCommand({ type: 'new_session' })

      const newName = sessionName ?? 'main'
      try {
        await worker.bridge.sendRpcCommand({ type: 'set_session_name', name: newName })
      } catch {}

      try {
        await worker.bridge.sendRpcCommand({ type: 'flush_session' })
      } catch {}

      sessionService.deleteSession(oldPath)

      let newSessionPath: string | null = null
      try {
        const postState = (await worker.bridge.sendRpcCommand({ type: 'get_state' })) as Record<string, unknown>
        const sp = typeof postState.sessionFile === 'string' ? postState.sessionFile : null
        if (sp) {
          newSessionPath = sp
        }
      } catch {}

      if (worker.sessionPath) {
        try {
          await worker.bridge.sendRpcCommand({ type: 'switch_session', sessionPath: worker.sessionPath })
        } catch {}
      }

      return { success: true, sessionPath: newSessionPath }
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('session:clearMessages', async (_event, sessionPath: string) => {
    try {
      // 1. Rewrite the session file: keep header + session_info, remove messages + fork_points
      const ok = sessionService.clearSessionMessages(sessionPath)
      if (!ok) {
        return { success: false, error: 'Failed to clear session file' }
      }

      // 2. If this is the worker's active session, tell it to reload from the cleared file
      const primary = workerManager?.getPrimary()
      if (primary?.bridge.isConnected) {
        try {
          const stateData = (await primary.bridge.sendRpcCommand({ type: 'get_state' })) as Record<string, unknown>
          const currentPath = typeof stateData.sessionFile === 'string' ? stateData.sessionFile : null
          if (currentPath === sessionPath) {
            // Reload the session so the worker picks up the cleared state
            await primary.bridge.sendRpcCommand({ type: 'switch_session', sessionPath })
          }
        } catch {
          // Worker might be in a different session — that's fine
        }
      }

      return { success: true, sessionPath }
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('session:getLastSession', () => {
    return sessionService.getLastSession(process.cwd())
  })

  ipcMain.handle('session:saveLastSession', (_event, sessionPath: string) => {
    sessionService.saveLastSession(process.cwd(), sessionPath)
    return { ok: true }
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

  ipcMain.handle('fs:writeFile', async (_event, filePath: string, content: string) => {
    try {
      const dir = dirname(filePath)
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true })
      }
      writeFileSync(filePath, content, 'utf-8')
      return { ok: true }
    } catch (err: unknown) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('fs:search', async (_event, query: string, options?: { includePattern?: string; excludePattern?: string; maxResults?: number }) => {
    try {
      const cwd = process.cwd()
      const maxResults = options?.maxResults ?? 200

      try {
        const args = ['--json', '--max-count', '50', '--ignore-case', '--max-filesize', '2M']
        if (options?.includePattern) args.push('--glob', options.includePattern)
        if (options?.excludePattern) args.push('--glob', `!${options.excludePattern}`)
        args.push(query, cwd)

        const stdout = await new Promise<string>((resolve, reject) => {
          execFile('rg', args, { timeout: 10000, maxBuffer: 10 * 1024 * 1024 }, (err, stdout) => {
            if (err && !stdout) reject(err)
            else resolve(stdout || '')
          })
        })

        const results: Array<{ filePath: string; relativePath: string; matches: Array<{ lineNumber: number; lineContent: string; matchStart: number; matchEnd: number }> }> = []
        const fileMap = new Map<string, Array<{ lineNumber: number; lineContent: string; matchStart: number; matchEnd: number }>>()

        for (const line of stdout.split('\n')) {
          if (!line.trim()) continue
          try {
            const obj = JSON.parse(line)
            if (obj.type !== 'match') continue
            const data = obj.data || {}
            const filePath: string = data.path?.text ?? ''
            const lineNumber: number = data.line_number ?? 0
            const lineContent: string = data.lines?.text ?? ''
            const submatches: Array<{ start: number; end: number }> = data.submatches ?? []
            const matchStart = submatches[0]?.start ?? 0
            const matchEnd = submatches[0]?.end ?? matchStart

            if (!fileMap.has(filePath)) fileMap.set(filePath, [])
            const matches = fileMap.get(filePath)!
            if (matches.length < 50) {
              matches.push({ lineNumber, lineContent: lineContent.replace(/\n$/, ''), matchStart, matchEnd })
            }
          } catch { continue }

          if (results.length >= maxResults) break
        }

        for (const [filePath, matches] of fileMap) {
          results.push({ filePath, relativePath: filePath.startsWith(cwd + '/') ? filePath.slice(cwd.length + 1) : filePath, matches })
          if (results.length >= maxResults) break
        }

        return { ok: true, results }
      } catch {
        const results: Array<{ filePath: string; relativePath: string; matches: Array<{ lineNumber: number; lineContent: string; matchStart: number; matchEnd: number }> }> = []
        const q = query.toLowerCase()
        const maxFileSize = 2 * 1024 * 1024
        const BINARY_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'bmp', 'ico', 'svg', 'webp', 'mp3', 'mp4', 'wav', 'zip', 'tar', 'gz', 'rar', '7z', 'pdf', 'woff', 'woff2', 'ttf', 'eot', 'otf', 'lock'])

        function walkAndSearch(dirPath: string, depth: number): void {
          if (depth > 5 || results.length >= maxResults) return
          try {
            const entries = readdirSync(dirPath, { withFileTypes: true })
            for (const entry of entries) {
              if (results.length >= maxResults) break
              if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === '.git') continue
              const fullPath = join(dirPath, entry.name)
              if (entry.isDirectory()) {
                walkAndSearch(fullPath, depth + 1)
              } else if (entry.isFile()) {
                const ext = extname(entry.name).slice(1).toLowerCase()
                if (BINARY_EXTS.has(ext)) continue
                try {
                  const stat = statSync(fullPath)
                  if (stat.size > maxFileSize) continue
                  const content = readFileSync(fullPath, 'utf-8')
                  const lines = content.split('\n')
                  const matches: Array<{ lineNumber: number; lineContent: string; matchStart: number; matchEnd: number }> = []
                  for (let i = 0; i < lines.length && matches.length < 50; i++) {
                    const idx = lines[i].toLowerCase().indexOf(q)
                    if (idx !== -1) {
                      matches.push({ lineNumber: i + 1, lineContent: lines[i], matchStart: idx, matchEnd: idx + query.length })
                    }
                  }
                  if (matches.length > 0) {
                    results.push({ filePath: fullPath, relativePath: fullPath.startsWith(cwd + '/') ? fullPath.slice(cwd.length + 1) : fullPath, matches })
                  }
                } catch { continue }
              }
            }
          } catch { return }
        }

        walkAndSearch(cwd, 0)
        return { ok: true, results }
      }
    } catch (err: unknown) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('git:checkAvailable', async () => {
    return { available: await checkGitAvailable() }
  })

  ipcMain.handle('git:status', async () => {
    try {
      const gitAvailable = await checkGitAvailable()
      if (!gitAvailable) {
        return { ok: false, error: 'Git is not installed. Please install Git and restart Xi.' }
      }
      const isRepo = await withRetry(git => git.checkIsRepo())
      if (!isRepo) return { ok: false, error: 'Not a git repository' }
      const status = await withRetry(git => git.status())
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
      if ((err instanceof Error && (err as NodeJS.ErrnoException).code === 'ENOENT') || String(err).includes('ENOENT')) {
        _gitAvailable = false
        return { ok: false, error: 'Git is not installed. Please install Git and restart Xi.' }
      }
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('not a git repository')) {
        return { ok: false, error: 'Not a git repository' }
      }
      return { ok: false, error: msg }
    }
  })

  ipcMain.handle('git:diff', async (_event, filePath: string, staged?: boolean) => {
    try {
      const gitAvailable = await checkGitAvailable()
      if (!gitAvailable) {
        return { ok: false, error: 'Git is not installed. Please install Git and restart Xi.' }
      }
      const diff = staged
        ? await withRetry(git => git.diff(['--cached', filePath]))
        : await withRetry(git => git.diff(['--', filePath]))
      return { ok: true, data: diff }
    } catch (err: unknown) {
      if ((err instanceof Error && (err as NodeJS.ErrnoException).code === 'ENOENT') || String(err).includes('ENOENT')) {
        _gitAvailable = false
        return { ok: false, error: 'Git is not installed. Please install Git and restart Xi.' }
      }
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('not a git repository')) {
        return { ok: false, error: 'Not a git repository' }
      }
      return { ok: false, error: msg }
    }
  })

  ipcMain.handle('git:diffCached', async () => {
    try {
      const gitAvailable = await checkGitAvailable()
      if (!gitAvailable) {
        return { ok: false, error: 'Git is not installed. Please install Git and restart Xi.' }
      }
      const diff = await withRetry(git => git.diff(['--cached']))
      return { ok: true, data: diff }
    } catch (err: unknown) {
      if ((err instanceof Error && (err as NodeJS.ErrnoException).code === 'ENOENT') || String(err).includes('ENOENT')) {
        _gitAvailable = false
        return { ok: false, error: 'Git is not installed. Please install Git and restart Xi.' }
      }
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('not a git repository')) {
        return { ok: false, error: 'Not a git repository' }
      }
      return { ok: false, error: msg }
    }
  })

  ipcMain.handle('git:stage', async (_event, filePaths: string[]) => {
    try {
      const gitAvailable = await checkGitAvailable()
      if (!gitAvailable) {
        return { ok: false, error: 'Git is not installed. Please install Git and restart Xi.' }
      }
      await withRetry(git => git.add(filePaths))
      return { ok: true }
    } catch (err: unknown) {
      if ((err instanceof Error && (err as NodeJS.ErrnoException).code === 'ENOENT') || String(err).includes('ENOENT')) {
        _gitAvailable = false
        return { ok: false, error: 'Git is not installed. Please install Git and restart Xi.' }
      }
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('not a git repository')) {
        return { ok: false, error: 'Not a git repository' }
      }
      return { ok: false, error: msg }
    }
  })

  ipcMain.handle('git:unstage', async (_event, filePaths: string[]) => {
    try {
      const gitAvailable = await checkGitAvailable()
      if (!gitAvailable) {
        return { ok: false, error: 'Git is not installed. Please install Git and restart Xi.' }
      }
      await withRetry(git => git.reset(['HEAD', '--', ...filePaths]))
      return { ok: true }
    } catch (err: unknown) {
      if ((err instanceof Error && (err as NodeJS.ErrnoException).code === 'ENOENT') || String(err).includes('ENOENT')) {
        _gitAvailable = false
        return { ok: false, error: 'Git is not installed. Please install Git and restart Xi.' }
      }
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('not a git repository')) {
        return { ok: false, error: 'Not a git repository' }
      }
      return { ok: false, error: msg }
    }
  })

  ipcMain.handle('git:commit', async (_event, message: string) => {
    try {
      const gitAvailable = await checkGitAvailable()
      if (!gitAvailable) {
        return { ok: false, error: 'Git is not installed. Please install Git and restart Xi.' }
      }
      await withRetry(git => git.commit(message))
      return { ok: true }
    } catch (err: unknown) {
      if ((err instanceof Error && (err as NodeJS.ErrnoException).code === 'ENOENT') || String(err).includes('ENOENT')) {
        _gitAvailable = false
        return { ok: false, error: 'Git is not installed. Please install Git and restart Xi.' }
      }
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('not a git repository')) {
        return { ok: false, error: 'Not a git repository' }
      }
      return { ok: false, error: msg }
    }
  })

  ipcMain.handle('git:discard', async (_event, filePaths: string[]) => {
    try {
      const gitAvailable = await checkGitAvailable()
      if (!gitAvailable) {
        return { ok: false, error: 'Git is not installed. Please install Git and restart Xi.' }
      }
      await withRetry(git => git.checkout(['--', ...filePaths]))
      return { ok: true }
    } catch (err: unknown) {
      if ((err instanceof Error && (err as NodeJS.ErrnoException).code === 'ENOENT') || String(err).includes('ENOENT')) {
        _gitAvailable = false
        return { ok: false, error: 'Git is not installed. Please install Git and restart Xi.' }
      }
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('not a git repository')) {
        return { ok: false, error: 'Not a git repository' }
      }
      return { ok: false, error: msg }
    }
  })

  ipcMain.handle('git:log', async (_event, options?: { maxCount?: number; skip?: number }) => {
    try {
      const gitAvailable = await checkGitAvailable()
      if (!gitAvailable) {
        return { ok: false, error: 'Git is not installed. Please install Git and restart Xi.' }
      }
      const isRepo = await withRetry(git => git.checkIsRepo())
      if (!isRepo) return { ok: false, error: 'Not a git repository' }
      const maxCount = options?.maxCount ?? 50
      const skip = options?.skip ?? 0
      const logArgs = [`--max-count=${maxCount}`]
      if (skip > 0) logArgs.push(`--skip=${skip}`)
      const log = await withRetry(git => git.log(logArgs))
      const commits = log.all.map((entry) => ({
        hash: entry.hash,
        shortHash: entry.hash.slice(0, 7),
        message: entry.message,
        body: entry.body,
        author_name: entry.author_name,
        author_email: entry.author_email,
        date: entry.date,
        refs: entry.refs,
      }))
      return { ok: true, data: commits }
    } catch (err: unknown) {
      if ((err instanceof Error && (err as NodeJS.ErrnoException).code === 'ENOENT') || String(err).includes('ENOENT')) {
        _gitAvailable = false
        return { ok: false, error: 'Git is not installed. Please install Git and restart Xi.' }
      }
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('not a git repository')) {
        return { ok: false, error: 'Not a git repository' }
      }
      return { ok: false, error: msg }
    }
  })

  ipcMain.handle('git:commitDetail', async (_event, hash: string) => {
    try {
      const gitAvailable = await checkGitAvailable()
      if (!gitAvailable) {
        return { ok: false, error: 'Git is not installed. Please install Git and restart Xi.' }
      }
      // Get commit info + stat using git show
      const formatStr = '%H%n%h%n%s%n%b%n%an%n%ae%n%aI%n%D'
      const raw = await withRetry(git => git.show(['--stat=4096', `--format=${formatStr}`, hash]))
      const lines = raw.split('\n')
      // First 8 lines are the formatted commit info
      const fullHash = lines[0] || ''
      const shortHash = lines[1] || ''
      const message = lines[2] || ''
      // body may span multiple lines until author_name line
      // Find the author line by looking for email pattern after body
      // Body may span multiple lines; we detect author_name line by checking
      // if the NEXT line looks like an email (contains @)
      let bodyEndIdx = 3
      for (let i = 3; i < lines.length - 1; i++) {
        // The author email line typically looks like: user@example.com
        if (lines[i + 1].includes('@') && !lines[i + 1].includes('://')) {
          bodyEndIdx = i
          break
        }
      }
      const body = lines.slice(3, bodyEndIdx).join('\n').trimEnd()
      const authorName = lines[bodyEndIdx] || ''
      const authorEmail = lines[bodyEndIdx + 1] || ''
      const date = lines[bodyEndIdx + 2] || ''
      const refs = lines[bodyEndIdx + 3] || ''

      // Parse stat section (after the blank line following refs)
      const statStart = bodyEndIdx + 4
      const files: Array<{ path: string; status: string; additions: number; deletions: number }> = []

      // Find the stat lines - they look like:
      //  src/file.ts | 2 +-
      //  src/added.ts | 5 ++++
      //  src/deleted.ts | 10 ----------
      // or for renames:  old => new | ...
      for (let i = statStart; i < lines.length; i++) {
        const line = lines[i]
        if (!line.trim() || line.startsWith('commit ') || line.startsWith('Author:') || line.startsWith('Date:')) continue
        const statMatch = line.match(/\s+(.+?)\s+\|\s+(\d+)\s+([+-]+)/)
        if (statMatch) {
          let filePath = statMatch[1].trim()
          // Handle rename: "old => new" or "{old => new}/file.ts"
          let status = 'M'
          const plusCount = (statMatch[3].match(/\+/g) || []).length
          const minusCount = (statMatch[3].match(/-/g) || []).length
          if (filePath.includes('=>')) {
            if (plusCount > 0 && minusCount === 0) status = 'R'
            else status = 'M' // rename + modify
            // Show the new path
            const renameMatch = filePath.match(/=>\s*(.+)/)
            if (renameMatch) {
              const newPath = renameMatch[1].trim()
              // Handle {old => new}/file.ts style
              const braceMatch = filePath.match(/\{(.+?)\s*=>\s*(.+?)\}/)
              if (braceMatch) {
                filePath = filePath.replace(/\{.+?\s*=>\s*(.+?)\}/, braceMatch[2].trim())
              } else {
                filePath = newPath
              }
            }
          } else if (minusCount > 0 && plusCount === 0) {
            // All deletions - but could be a modify too. Check if file exists?
            // For now, let's check the diff for actual status
            status = 'M' // We'll refine this below
          }
          // Binary files show as: file.bin | Bin 123 -> 456 bytes
          const binMatch = line.match(/\s+(.+?)\s+\|\s+Bin\s+/)
          if (!binMatch) {
            files.push({ path: filePath, status, additions: plusCount, deletions: minusCount })
          }
        }
      }

      // Refine file statuses using diff-tree if available
      try {
        const nameStatus = await withRetry(g => g.raw(['diff-tree', '--no-commit-id', '--name-status', '-r', hash]))
        const statusMap = new Map<string, string>()
        for (const nsLine of nameStatus.split('\n')) {
          const parts = nsLine.trim().split('\t')
          if (parts.length >= 2) {
            // Status like M, A, D, R100, C100
            const statusCode = parts[0].trim().charAt(0)
            // For renames, parts[1] is old path, parts[2] is new path
            const fpath = parts.length >= 3 ? parts[2] : parts[1]
            statusMap.set(fpath, statusCode)
          }
        }
        // Update files with accurate statuses
        for (const f of files) {
          const accurate = statusMap.get(f.path)
          if (accurate) f.status = accurate
        }
      } catch {
        // diff-tree may fail for initial commits, that's ok
      }

      return {
        ok: true,
        data: {
          hash: fullHash,
          shortHash,
          message,
          body,
          author_name: authorName,
          author_email: authorEmail,
          date,
          refs,
          files,
        },
      }
    } catch (err: unknown) {
      if ((err instanceof Error && (err as NodeJS.ErrnoException).code === 'ENOENT') || String(err).includes('ENOENT')) {
        _gitAvailable = false
        return { ok: false, error: 'Git is not installed. Please install Git and restart Xi.' }
      }
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('not a git repository')) {
        return { ok: false, error: 'Not a git repository' }
      }
      return { ok: false, error: msg }
    }
  })

  ipcMain.handle('git:commitFileDiff', async (_event, hash: string, filePath: string) => {
    try {
      const gitAvailable = await checkGitAvailable()
      if (!gitAvailable) {
        return { ok: false, error: 'Git is not installed. Please install Git and restart Xi.' }
      }
      const diff = await withRetry(git => git.show([hash, '--', filePath]))
      return { ok: true, data: diff }
    } catch (err: unknown) {
      if ((err instanceof Error && (err as NodeJS.ErrnoException).code === 'ENOENT') || String(err).includes('ENOENT')) {
        _gitAvailable = false
        return { ok: false, error: 'Git is not installed. Please install Git and restart Xi.' }
      }
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('not a git repository')) {
        return { ok: false, error: 'Not a git repository' }
      }
      return { ok: false, error: msg }
    }
  })

  let watcherCleanup: (() => void) | null = null

  function parseGitignore(rootDir: string): string[] {
    const patterns: string[] = ['node_modules', '.git']
    const gitignorePath = join(rootDir, '.gitignore')
    if (!existsSync(gitignorePath)) return patterns
    try {
      const content = readFileSync(gitignorePath, 'utf-8')
      for (const line of content.split('\n')) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('!')) continue
        patterns.push(trimmed)
      }
    } catch {}
    return patterns
  }

  ipcMain.handle('fs:watchStart', async (event) => {
    if (watcherCleanup) return { ok: true }
    const projectPath = process.cwd()
    const ignoredPatterns = parseGitignore(projectPath)
    const watcher = watch(projectPath, {
      ignored: ignoredPatterns,
      ignoreInitial: true,
      depth: 3,
      ignorePermissionErrors: true,
      usePolling: true,
      interval: 1000,
      awaitWriteFinish: {
        stabilityThreshold: 500,
        pollInterval: 100,
      },
    })
    let debounceTimer: ReturnType<typeof setTimeout> | null = null
    const sendChange = () => {
      try {
        if (!mainWindow || mainWindow.isDestroyed()) return
        mainWindow.webContents.send('fs:changed')
      } catch {}
    }
    watcher.on('all', () => {
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(sendChange, 300)
    })
    watcherCleanup = () => {
      watcher.close()
      watcherCleanup = null
      if (debounceTimer) clearTimeout(debounceTimer)
    }
    return { ok: true }
  })

  ipcMain.handle('fs:watchStop', async () => {
    if (watcherCleanup) {
      watcherCleanup()
    }
    return { ok: true }
  })

  const ptyProcesses = new Map<string, import('node-pty').IPty>()

  ipcMain.handle('terminal:create', async (_event, ptyId: string, cwd?: string) => {
    try {
      const pty = (await import('node-pty')).spawn(process.platform === 'win32' ? 'powershell.exe' : process.env.SHELL || '/bin/zsh', [], {
        name: 'xterm-256color',
        cols: 80,
        rows: 24,
        cwd: cwd || process.cwd(),
        env: { ...process.env } as Record<string, string>,
      })
      ptyProcesses.set(ptyId, pty)
      pty.onData((data: string) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('terminal:data', ptyId, data)
        }
      })
      pty.onExit(() => {
        ptyProcesses.delete(ptyId)
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('terminal:exit', ptyId)
        }
      })
      return { ok: true }
    } catch (err: unknown) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('terminal:write', async (_event, ptyId: string, data: string) => {
    const pty = ptyProcesses.get(ptyId)
    if (!pty) return { ok: false, error: 'Terminal not found' }
    pty.write(data)
    return { ok: true }
  })

  ipcMain.handle('terminal:resize', async (_event, ptyId: string, cols: number, rows: number) => {
    const pty = ptyProcesses.get(ptyId)
    if (!pty) return { ok: false, error: 'Terminal not found' }
    pty.resize(cols, rows)
    return { ok: true }
  })

  ipcMain.handle('terminal:kill', async (_event, ptyId: string) => {
    const pty = ptyProcesses.get(ptyId)
    if (!pty) return { ok: true }
    pty.kill()
    ptyProcesses.delete(ptyId)
    return { ok: true }
  })

  ipcMain.handle('skills:list', async () => {
    try {
      const primary = workerManager?.getPrimary()
      if (!primary?.bridge.isConnected) {
        return { ok: false, error: 'Worker not connected' }
      }
      // Reload resources from disk so newly added skills are discovered
      await primary.bridge.sendRpcCommand({ type: 'reload_skills' })
      const data = await primary.bridge.sendRpcCommand({ type: 'get_skills' }) as {
        skills: Array<{
          name: string
          description: string
          filePath: string
          baseDir: string
          source: string
          scope: string
          origin: string
          disableModelInvocation: boolean
        }>
        diagnostics: Array<{
          type: string
          message: string
          path?: string
          collision?: { resourceType: string; name: string; winnerPath: string; loserPath: string }
        }>
      }
      return { ok: true, data: data.skills, diagnostics: data.diagnostics }
    } catch (err: unknown) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('skills:read', async (_event, filePath: string) => {
    try {
      const primary = workerManager?.getPrimary()
      if (!primary?.bridge.isConnected) {
        return { ok: false, error: 'Worker not connected' }
      }
      const data = await primary.bridge.sendRpcCommand({ type: 'read_skill', filePath })
      return { ok: true, data }
    } catch (err: unknown) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // Discover available harness skill directories on this machine
  ipcMain.handle('skills:discoverHarnessDirs', async () => {
    try {
      const homeDir = process.env.HOME ?? process.env.USERPROFILE ?? ''
      const knownHarnesses = [
        { id: 'claude', label: 'Claude Code', dir: join(homeDir, '.claude', 'skills') },
        { id: 'codex', label: 'OpenAI Codex', dir: join(homeDir, '.codex', 'skills') },
        { id: 'opencode', label: 'OpenCode', dir: join(homeDir, '.opencode', 'skills') },
        { id: 'opencode-config', label: 'OpenCode', dir: join(homeDir, '.config', 'opencode', 'skills') },
        { id: 'agents', label: 'Agent Skills', dir: join(homeDir, '.agents', 'skills') },
      ]
      const discovered = knownHarnesses
        .filter(h => existsSync(h.dir))
        .map(h => ({
          id: h.id,
          label: h.label,
          dir: h.dir,
          skillCount: readdirSync(h.dir, { withFileTypes: true })
            .filter(e => !e.name.startsWith('.')).length,
        }))
      return { ok: true, data: discovered }
    } catch (err: unknown) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // Get current skills config from settings.json
  ipcMain.handle('skills:getSettings', async () => {
    try {
      const homeDir = process.env.HOME ?? process.env.USERPROFILE ?? ''
      const agentDir = process.env.PI_CODING_AGENT_DIR || join(homeDir, '.xi')
      const settingsPath = join(agentDir, 'settings.json')
      let skillsPaths: string[] = []
      if (existsSync(settingsPath)) {
        try {
          const content = readFileSync(settingsPath, 'utf-8')
          const settings = JSON.parse(content)
          skillsPaths = settings.skills ?? []
        } catch {}
      }
      return { ok: true, data: { skillsPaths } }
    } catch (err: unknown) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // Update skills config in settings.json
  ipcMain.handle('skills:updateSettings', async (_event, skillsPaths: string[]) => {
    try {
      const homeDir = process.env.HOME ?? process.env.USERPROFILE ?? ''
      const agentDir = process.env.PI_CODING_AGENT_DIR || join(homeDir, '.xi')
      const settingsPath = join(agentDir, 'settings.json')
      let settings: Record<string, unknown> = {}
      if (existsSync(settingsPath)) {
        try {
          const content = readFileSync(settingsPath, 'utf-8')
          settings = JSON.parse(content)
        } catch {}
      }
      settings.skills = skillsPaths
      writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n')

      // Tell worker to reload resources so new skills take effect
      try {
        const primary = workerManager?.getPrimary()
        if (primary?.bridge.isConnected) {
          await primary.bridge.sendRpcCommand({ type: 'reload_skills' })
        }
      } catch {}

      return { ok: true }
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

  ipcMain.handle('mcp:ping', async (_event, serverConfig: { command: string; args?: string[]; env?: Record<string, string> }) => {
    return new Promise<{ ok: boolean; connected: boolean }>((resolve) => {
      const timeout = setTimeout(() => {
        child.kill()
        resolve({ ok: true, connected: false })
      }, 3000)
      try {
        const { spawn } = require('child_process') as typeof import('child_process')
        const child = spawn(serverConfig.command, serverConfig.args ?? [], {
          env: { ...process.env, ...serverConfig.env } as Record<string, string>,
          stdio: ['pipe', 'pipe', 'pipe'],
        })
        const initMsg = JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'xi', version: '0.1.0' },
          },
        }) + '\n'
        child.stdin.write(initMsg)
        let buffer = ''
        child.stdout.on('data', (data: Buffer) => {
          buffer += data.toString()
          try {
            JSON.parse(buffer.trim())
            clearTimeout(timeout)
            child.kill()
            resolve({ ok: true, connected: true })
          } catch {}
        })
        child.on('error', () => {
          clearTimeout(timeout)
          resolve({ ok: true, connected: false })
        })
        child.on('exit', () => {
          clearTimeout(timeout)
          resolve({ ok: true, connected: false })
        })
      } catch {
        clearTimeout(timeout)
        resolve({ ok: true, connected: false })
      }
    })
  })
}

app.whenReady().then(() => {
  nativeTheme.themeSource = 'dark'

  // Restore last project cwd if available and current cwd doesn't match
  try {
    const recentProjectsFile = join(app.getPath('userData'), 'recent-projects.json')
    if (existsSync(recentProjectsFile)) {
      const data = JSON.parse(readFileSync(recentProjectsFile, 'utf-8')) as { recentProjects: Array<{ path: string; name: string; lastOpened: string }> }
      if (data.recentProjects?.length > 0) {
        const savedCwd = data.recentProjects[0].path
        if (savedCwd && existsSync(savedCwd) && resolve(savedCwd) !== resolve(process.cwd())) {
          process.chdir(savedCwd)
        }
      }
    }
  } catch {}

  let mainSession = sessionService.findMainSession(process.cwd())

  if (mainSession && !mainSession.name) {
    sessionService.nameSession(mainSession.filePath, 'main')
    sessionService.flushPendingName(mainSession.filePath)
    mainSession = { ...mainSession, name: 'main' }
  }

  initWorkerManager(mainSession?.filePath)
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
  const primary = workerManager?.getPrimary()
  if (primary?.bridge.isConnected) {
    try {
      const stateData = primary.bridge.sendRpcCommand({ type: 'get_state' }) as Promise<Record<string, unknown>>
      stateData.then((data) => {
        if (typeof data.sessionFile === 'string') {
          sessionService.saveLastSession(process.cwd(), data.sessionFile)
        }
      }).catch(() => {})
    } catch {}
  }
  try {
    const recentProjectsFile = join(app.getPath('userData'), 'recent-projects.json')
    const currentCwd = process.cwd()
    const projectName = basename(currentCwd)
    let projects: Array<{ path: string; name: string; lastOpened: string }> = []
    try {
      if (existsSync(recentProjectsFile)) {
        const data = JSON.parse(readFileSync(recentProjectsFile, 'utf-8')) as { recentProjects: Array<{ path: string; name: string; lastOpened: string }> }
        projects = data.recentProjects ?? []
      }
    } catch {}
    projects = projects.filter(p => p.path !== currentCwd)
    projects.unshift({ path: currentCwd, name: projectName, lastOpened: new Date().toISOString() })
    projects = projects.slice(0, 15)
    writeFileSync(recentProjectsFile, JSON.stringify({ recentProjects: projects }, null, 2))
  } catch {}
  workerManager?.disposeAll().catch((err: Error) => {
    console.error('[WorkerManager] Error during shutdown:', err.message)
  })
})
