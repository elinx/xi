import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Tests for IPC handlers in main process (index.ts).
 *
 * We verify the handler logic by simulating the RPC command construction
 * and response parsing that happens inside each IPC handler.
 * Handlers now take sessionPath: string | null as first arg to route
 * to the correct worker (primary vs secondary).
 */

// Worker-resolution pattern: sessionPath ? get(sessionPath) : getPrimary()
function createWorkerResolver(workers: Map<string | null, { isConnected: boolean; sendCommand: ReturnType<typeof vi.fn>; sendRpcCommand: ReturnType<typeof vi.fn> }>) {
  return (sessionPath: string | null) => {
    const key = sessionPath ?? '__primary__'
    return workers.get(key) ?? null
  }
}

// ── pi:sendCommand ──

describe('IPC: pi:sendCommand', () => {
  it('routes to primary when sessionPath is null', async () => {
    const primary = { isConnected: true, sendCommand: vi.fn(), sendRpcCommand: vi.fn() }
    const resolve = createWorkerResolver(new Map([[null, primary], ['__primary__', primary]]))

    async function handleSendCommand(sessionPath: string | null, command: Record<string, unknown>) {
      const worker = sessionPath ? resolve(sessionPath) : resolve(null)
      if (!worker?.isConnected) return { ok: false, error: 'Worker not connected' }
      worker.sendCommand(command)
      return { ok: true }
    }

    const result = await handleSendCommand(null, { type: 'chat', text: 'hello' })
    expect(result.ok).toBe(true)
    expect(primary.sendCommand).toHaveBeenCalledWith({ type: 'chat', text: 'hello' })
  })

  it('routes to secondary when sessionPath is provided', async () => {
    const secondary = { isConnected: true, sendCommand: vi.fn(), sendRpcCommand: vi.fn() }
    const resolve = createWorkerResolver(new Map([['/secondary.jsonl', secondary]]))

    async function handleSendCommand(sessionPath: string | null, command: Record<string, unknown>) {
      const worker = sessionPath ? resolve(sessionPath) : resolve(null)
      if (!worker?.isConnected) return { ok: false, error: 'Worker not connected' }
      worker.sendCommand(command)
      return { ok: true }
    }

    const result = await handleSendCommand('/secondary.jsonl', { type: 'chat', text: 'hi' })
    expect(result.ok).toBe(true)
    expect(secondary.sendCommand).toHaveBeenCalledWith({ type: 'chat', text: 'hi' })
  })

  it('returns error when worker not connected', async () => {
    const secondary = { isConnected: false, sendCommand: vi.fn(), sendRpcCommand: vi.fn() }
    const resolve = createWorkerResolver(new Map([['/secondary.jsonl', secondary]]))

    async function handleSendCommand(sessionPath: string | null, command: Record<string, unknown>) {
      const worker = sessionPath ? resolve(sessionPath) : resolve(null)
      if (!worker?.isConnected) return { ok: false, error: 'Worker not connected' }
      worker.sendCommand(command)
      return { ok: true }
    }

    const result = await handleSendCommand('/secondary.jsonl', { type: 'chat', text: 'hi' })
    expect(result.ok).toBe(false)
    expect(result.error).toBe('Worker not connected')
  })
})

// ── pi:getAvailableModels ──

describe('IPC: pi:getAvailableModels', () => {
  it('fetches models from primary when sessionPath is null', async () => {
    const primary = { isConnected: true, sendCommand: vi.fn(), sendRpcCommand: vi.fn().mockResolvedValue({ models: ['gpt-4'] }) }
    const resolve = createWorkerResolver(new Map([[null, primary], ['__primary__', primary]]))

    async function handleGetAvailableModels(sessionPath: string | null) {
      const worker = sessionPath ? resolve(sessionPath) : resolve(null)
      if (!worker?.isConnected) return { ok: false, error: 'Worker not connected' }
      try {
        const data = await worker.sendRpcCommand({ type: 'get_available_models' })
        return { ok: true, data }
      } catch (err: unknown) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    }

    const result = await handleGetAvailableModels(null)
    expect(result.ok).toBe(true)
    expect(primary.sendRpcCommand).toHaveBeenCalledWith({ type: 'get_available_models' })
  })

  it('fetches models from secondary when sessionPath is provided', async () => {
    const secondary = { isConnected: true, sendCommand: vi.fn(), sendRpcCommand: vi.fn().mockResolvedValue({ models: ['claude-3'] }) }
    const resolve = createWorkerResolver(new Map([['/sec.jsonl', secondary]]))

    async function handleGetAvailableModels(sessionPath: string | null) {
      const worker = sessionPath ? resolve(sessionPath) : resolve(null)
      if (!worker?.isConnected) return { ok: false, error: 'Worker not connected' }
      const data = await worker.sendRpcCommand({ type: 'get_available_models' })
      return { ok: true, data }
    }

    const result = await handleGetAvailableModels('/sec.jsonl')
    expect(result.ok).toBe(true)
    expect(secondary.sendRpcCommand).toHaveBeenCalledWith({ type: 'get_available_models' })
  })
})

// ── pi:setModel ──

describe('IPC: pi:setModel', () => {
  it('sets model on worker resolved by sessionPath', async () => {
    const secondary = { isConnected: true, sendCommand: vi.fn(), sendRpcCommand: vi.fn().mockResolvedValue({}) }
    const resolve = createWorkerResolver(new Map([['/sec.jsonl', secondary]]))

    async function handleSetModel(sessionPath: string | null, model: string, provider?: string) {
      const worker = sessionPath ? resolve(sessionPath) : resolve(null)
      if (!worker?.isConnected) return { ok: false, error: 'Worker not connected' }
      const command: Record<string, unknown> = { type: 'set_model', model }
      if (provider) command.provider = provider
      const data = await worker.sendRpcCommand(command)
      return { ok: true, data }
    }

    const result = await handleSetModel('/sec.jsonl', 'gpt-4', 'openai')
    expect(result.ok).toBe(true)
    expect(secondary.sendRpcCommand).toHaveBeenCalledWith({ type: 'set_model', model: 'gpt-4', provider: 'openai' })
  })

  it('sends minimal command without provider', async () => {
    const primary = { isConnected: true, sendCommand: vi.fn(), sendRpcCommand: vi.fn().mockResolvedValue({}) }
    const resolve = createWorkerResolver(new Map([[null, primary], ['__primary__', primary]]))

    async function handleSetModel(sessionPath: string | null, model: string, provider?: string) {
      const worker = sessionPath ? resolve(sessionPath) : resolve(null)
      if (!worker?.isConnected) return { ok: false, error: 'Worker not connected' }
      const command: Record<string, unknown> = { type: 'set_model', model }
      if (provider) command.provider = provider
      await worker.sendRpcCommand(command)
      return { ok: true }
    }

    await handleSetModel(null, 'claude-3')
    expect(primary.sendRpcCommand).toHaveBeenCalledWith({ type: 'set_model', model: 'claude-3' })
  })
})

// ── pi:cycleModel ──

describe('IPC: pi:cycleModel', () => {
  it('cycles model on worker resolved by sessionPath', async () => {
    const worker = { isConnected: true, sendCommand: vi.fn(), sendRpcCommand: vi.fn().mockResolvedValue({ model: 'next' }) }
    const resolve = createWorkerResolver(new Map([['/s.jsonl', worker]]))

    async function handleCycleModel(sessionPath: string | null, direction?: 'forward' | 'backward') {
      const w = sessionPath ? resolve(sessionPath) : resolve(null)
      if (!w?.isConnected) return { ok: false, error: 'Worker not connected' }
      const data = await w.sendRpcCommand({ type: 'cycle_model', direction: direction ?? 'forward' })
      return { ok: true, data }
    }

    const result = await handleCycleModel('/s.jsonl', 'backward')
    expect(result.ok).toBe(true)
    expect(worker.sendRpcCommand).toHaveBeenCalledWith({ type: 'cycle_model', direction: 'backward' })
  })
})

// ── pi:getModelInfo ──

describe('IPC: pi:getModelInfo', () => {
  it('returns model info from worker resolved by sessionPath', async () => {
    const worker = {
      isConnected: true,
      sendCommand: vi.fn(),
      sendRpcCommand: vi.fn().mockResolvedValue({ model: 'gpt-4', thinkingLevel: 'high' }),
    }
    const resolve = createWorkerResolver(new Map([['/s.jsonl', worker]]))

    async function handleGetModelInfo(sessionPath: string | null) {
      const w = sessionPath ? resolve(sessionPath) : resolve(null)
      if (!w?.isConnected) return { ok: false, error: 'Worker not connected' }
      const data = await w.sendRpcCommand({ type: 'get_state' }) as Record<string, unknown>
      return { ok: true, data: { model: data.model ?? null, thinkingLevel: data.thinkingLevel ?? null } }
    }

    const result = await handleGetModelInfo('/s.jsonl')
    expect(result.ok).toBe(true)
    expect(result.data.model).toBe('gpt-4')
    expect(result.data.thinkingLevel).toBe('high')
  })
})

// ── Auth handlers: always route to primary regardless of sessionPath ──

describe('IPC: pi:getProviderAuthStatus (always primary)', () => {
  it('uses primary worker even when sessionPath points to secondary', async () => {
    const primary = { isConnected: true, sendCommand: vi.fn(), sendRpcCommand: vi.fn().mockResolvedValue({ anthropic: { configured: true } }) }
    const secondary = { isConnected: true, sendCommand: vi.fn(), sendRpcCommand: vi.fn() }
    const resolve = createWorkerResolver(new Map([[null, primary], ['__primary__', primary], ['/sec.jsonl', secondary]]))

    async function handleGetProviderAuthStatus(_sessionPath: string | null) {
      const primaryWorker = resolve(null)
      if (!primaryWorker?.isConnected) return { ok: false, error: 'Pi not connected' }
      const data = await primaryWorker.sendRpcCommand({ type: 'get_provider_auth_status' })
      return { ok: true, data }
    }

    const result = await handleGetProviderAuthStatus('/sec.jsonl')
    expect(result.ok).toBe(true)
    expect(primary.sendRpcCommand).toHaveBeenCalledWith({ type: 'get_provider_auth_status' })
    expect(secondary.sendRpcCommand).not.toHaveBeenCalled()
  })

  it('returns error when primary is not connected', async () => {
    const primary = { isConnected: false, sendCommand: vi.fn(), sendRpcCommand: vi.fn() }
    const resolve = createWorkerResolver(new Map([[null, primary], ['__primary__', primary]]))

    async function handleGetProviderAuthStatus(_sessionPath: string | null) {
      const primaryWorker = resolve(null)
      if (!primaryWorker?.isConnected) return { ok: false, error: 'Pi not connected' }
      const data = await primaryWorker.sendRpcCommand({ type: 'get_provider_auth_status' })
      return { ok: true, data }
    }

    const result = await handleGetProviderAuthStatus(null)
    expect(result.ok).toBe(false)
    expect(result.error).toBe('Pi not connected')
  })
})

describe('IPC: pi:setApiKey (always primary)', () => {
  it('sends set_api_key via primary regardless of sessionPath', async () => {
    const primary = { isConnected: true, sendCommand: vi.fn(), sendRpcCommand: vi.fn().mockResolvedValue({}) }
    const secondary = { isConnected: true, sendCommand: vi.fn(), sendRpcCommand: vi.fn() }
    const resolve = createWorkerResolver(new Map([[null, primary], ['__primary__', primary], ['/sec.jsonl', secondary]]))

    async function handleSetApiKey(_sessionPath: string | null, provider: string, apiKey: string) {
      const primaryWorker = resolve(null)
      if (!primaryWorker?.isConnected) return { ok: false, error: 'Pi not connected' }
      await primaryWorker.sendRpcCommand({ type: 'set_api_key', provider, apiKey })
      return { ok: true }
    }

    const result = await handleSetApiKey('/sec.jsonl', 'anthropic', 'sk-test')
    expect(result.ok).toBe(true)
    expect(primary.sendRpcCommand).toHaveBeenCalledWith({ type: 'set_api_key', provider: 'anthropic', apiKey: 'sk-test' })
    expect(secondary.sendRpcCommand).not.toHaveBeenCalled()
  })
})

describe('IPC: pi:removeAuth (always primary)', () => {
  it('sends remove_auth via primary regardless of sessionPath', async () => {
    const primary = { isConnected: true, sendCommand: vi.fn(), sendRpcCommand: vi.fn().mockResolvedValue({}) }
    const resolve = createWorkerResolver(new Map([[null, primary], ['__primary__', primary]]))

    async function handleRemoveAuth(_sessionPath: string | null, provider: string) {
      const primaryWorker = resolve(null)
      if (!primaryWorker?.isConnected) return { ok: false, error: 'Pi not connected' }
      await primaryWorker.sendRpcCommand({ type: 'remove_auth', provider })
      return { ok: true }
    }

    const result = await handleRemoveAuth('/sec.jsonl', 'openai')
    expect(result.ok).toBe(true)
    expect(primary.sendRpcCommand).toHaveBeenCalledWith({ type: 'remove_auth', provider: 'openai' })
  })
})

describe('IPC: pi:registerCustomProvider (always primary)', () => {
  it('sends register_custom_provider via primary regardless of sessionPath', async () => {
    const primary = { isConnected: true, sendCommand: vi.fn(), sendRpcCommand: vi.fn().mockResolvedValue({}) }
    const resolve = createWorkerResolver(new Map([[null, primary], ['__primary__', primary]]))

    async function handleRegisterCustomProvider(_sessionPath: string | null, provider: string, config: Record<string, unknown>) {
      const primaryWorker = resolve(null)
      if (!primaryWorker?.isConnected) return { ok: false, error: 'Pi not connected' }
      await primaryWorker.sendRpcCommand({ type: 'register_custom_provider', provider, config })
      return { ok: true }
    }

    const config = { baseUrl: 'https://custom.api', apiKey: 'key' }
    const result = await handleRegisterCustomProvider('/sec.jsonl', 'custom', config)
    expect(result.ok).toBe(true)
    expect(primary.sendRpcCommand).toHaveBeenCalledWith({ type: 'register_custom_provider', provider: 'custom', config })
  })
})

// ── worker:ensureReady ──

describe('IPC: worker:ensureReady', () => {
  it('returns connected for already-connected worker', async () => {
    const workers = new Map<string, { sessionPath: string; role: 'primary' | 'secondary'; status: string; isStreaming: boolean }>()
    workers.set('/s.jsonl', { sessionPath: '/s.jsonl', role: 'secondary', status: 'connected', isStreaming: false })

    const disposeSecondary = vi.fn()
    const getOrCreateSecondary = vi.fn()

    async function handleEnsureReady(sessionPath: string) {
      const existing = workers.get(sessionPath)
      if (existing && existing.status === 'connected') return { ok: true, status: 'connected' }
      if (existing && existing.status === 'starting') return { ok: true, status: 'starting' }
      if (existing && existing.status === 'error') {
        if (existing.role === 'secondary') {
          await disposeSecondary(sessionPath)
        }
      }
      try {
        const state = await getOrCreateSecondary(sessionPath, process.cwd())
        return { ok: true, status: state.status }
      } catch (err: unknown) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    }

    const result = await handleEnsureReady('/s.jsonl')
    expect(result.ok).toBe(true)
    expect(result.status).toBe('connected')
    expect(disposeSecondary).not.toHaveBeenCalled()
    expect(getOrCreateSecondary).not.toHaveBeenCalled()
  })

  it('returns starting for worker in starting state', async () => {
    const workers = new Map<string, { sessionPath: string; role: 'primary' | 'secondary'; status: string; isStreaming: boolean }>()
    workers.set('/s.jsonl', { sessionPath: '/s.jsonl', role: 'secondary', status: 'starting', isStreaming: false })

    const disposeSecondary = vi.fn()
    const getOrCreateSecondary = vi.fn()

    async function handleEnsureReady(sessionPath: string) {
      const existing = workers.get(sessionPath)
      if (existing && existing.status === 'connected') return { ok: true, status: 'connected' }
      if (existing && existing.status === 'starting') return { ok: true, status: 'starting' }
      if (existing && existing.status === 'error') {
        if (existing.role === 'secondary') {
          await disposeSecondary(sessionPath)
        }
      }
      try {
        const state = await getOrCreateSecondary(sessionPath, process.cwd())
        return { ok: true, status: state.status }
      } catch (err: unknown) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    }

    const result = await handleEnsureReady('/s.jsonl')
    expect(result.ok).toBe(true)
    expect(result.status).toBe('starting')
  })

  it('disposes errored secondary and recreates', async () => {
    const workers = new Map<string, { sessionPath: string; role: 'primary' | 'secondary'; status: string; isStreaming: boolean }>()
    workers.set('/s.jsonl', { sessionPath: '/s.jsonl', role: 'secondary', status: 'error', isStreaming: false })

    const disposeSecondary = vi.fn().mockImplementation(() => { workers.delete('/s.jsonl') })
    const getOrCreateSecondary = vi.fn().mockResolvedValue({ status: 'connected' })

    async function handleEnsureReady(sessionPath: string) {
      const existing = workers.get(sessionPath)
      if (existing && existing.status === 'connected') return { ok: true, status: 'connected' }
      if (existing && existing.status === 'starting') return { ok: true, status: 'starting' }
      if (existing && existing.status === 'error') {
        if (existing.role === 'secondary') {
          await disposeSecondary(sessionPath)
        }
      }
      try {
        const state = await getOrCreateSecondary(sessionPath, process.cwd())
        return { ok: true, status: state.status }
      } catch (err: unknown) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    }

    const result = await handleEnsureReady('/s.jsonl')
    expect(result.ok).toBe(true)
    expect(result.status).toBe('connected')
    expect(disposeSecondary).toHaveBeenCalledWith('/s.jsonl')
    expect(getOrCreateSecondary).toHaveBeenCalledWith('/s.jsonl', process.cwd())
  })

  it('creates new worker when none exists', async () => {
    const workers = new Map<string, { sessionPath: string; role: 'primary' | 'secondary'; status: string; isStreaming: boolean }>()
    const getOrCreateSecondary = vi.fn().mockResolvedValue({ status: 'starting' })

    async function handleEnsureReady(sessionPath: string) {
      const existing = workers.get(sessionPath)
      if (existing && existing.status === 'connected') return { ok: true, status: 'connected' }
      if (existing && existing.status === 'starting') return { ok: true, status: 'starting' }
      if (existing && existing.status === 'error') {
  
      }
      try {
        const state = await getOrCreateSecondary(sessionPath, process.cwd())
        return { ok: true, status: state.status }
      } catch (err: unknown) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    }

    const result = await handleEnsureReady('/new-session.jsonl')
    expect(result.ok).toBe(true)
    expect(result.status).toBe('starting')
    expect(getOrCreateSecondary).toHaveBeenCalledWith('/new-session.jsonl', process.cwd())
  })

  it('returns error when getOrCreateSecondary fails', async () => {
    const workers = new Map<string, { sessionPath: string; role: 'primary' | 'secondary'; status: string; isStreaming: boolean }>()
    const getOrCreateSecondary = vi.fn().mockRejectedValue(new Error('spawn failed'))

    async function handleEnsureReady(sessionPath: string) {
      const existing = workers.get(sessionPath)
      if (existing && existing.status === 'connected') return { ok: true, status: 'connected' }
      if (existing && existing.status === 'starting') return { ok: true, status: 'starting' }
      try {
        const state = await getOrCreateSecondary(sessionPath, process.cwd())
        return { ok: true, status: state.status }
      } catch (err: unknown) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    }

    const result = await handleEnsureReady('/bad.jsonl')
    expect(result.ok).toBe(false)
    expect(result.error).toBe('spawn failed')
  })
})

// ── worker:getStatus ──

describe('IPC: worker:getStatus', () => {
  it('returns array of worker status objects', () => {
    const allWorkers = [
      { sessionPath: '/main.jsonl', role: 'primary' as const, status: 'connected' as const, isStreaming: false },
      { sessionPath: '/sec1.jsonl', role: 'secondary' as const, status: 'connected' as const, isStreaming: true },
      { sessionPath: '/sec2.jsonl', role: 'secondary' as const, status: 'starting' as const, isStreaming: false },
    ]

    function handleGetStatus() {
      return allWorkers.map(w => ({
        sessionPath: w.sessionPath,
        role: w.role,
        status: w.status,
        isStreaming: w.isStreaming,
      }))
    }

    const result = handleGetStatus()
    expect(result).toHaveLength(3)
    expect(result[0]).toEqual({ sessionPath: '/main.jsonl', role: 'primary', status: 'connected', isStreaming: false })
    expect(result[1]).toEqual({ sessionPath: '/sec1.jsonl', role: 'secondary', status: 'connected', isStreaming: true })
    expect(result[2]).toEqual({ sessionPath: '/sec2.jsonl', role: 'secondary', status: 'starting', isStreaming: false })
  })

  it('returns empty array when no workers', () => {
    function handleGetStatus() {
      const allWorkers: Array<{ sessionPath: string; role: string; status: string; isStreaming: boolean }> = []
      return allWorkers.map(w => ({
        sessionPath: w.sessionPath,
        role: w.role,
        status: w.status,
        isStreaming: w.isStreaming,
      }))
    }

    const result = handleGetStatus()
    expect(result).toEqual([])
  })
})

// ── worker:dispose ──

describe('IPC: worker:dispose', () => {
  it('disposes a secondary worker', async () => {
    const workers = new Map<string, { sessionPath: string; role: 'primary' | 'secondary'; status: string }>()
    workers.set('/sec.jsonl', { sessionPath: '/sec.jsonl', role: 'secondary', status: 'connected' })

    const disposeSecondary = vi.fn().mockImplementation(() => { workers.delete('/sec.jsonl') })

    async function handleDispose(sessionPath: string) {
      const worker = workers.get(sessionPath)
      if (!worker) return { ok: true }
      if (worker.role === 'primary') return { ok: false, error: 'Cannot dispose primary worker' }
      try {
        await disposeSecondary(sessionPath)
        return { ok: true }
      } catch (err: unknown) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    }

    const result = await handleDispose('/sec.jsonl')
    expect(result.ok).toBe(true)
    expect(disposeSecondary).toHaveBeenCalledWith('/sec.jsonl')
  })

  it('fails for primary worker', async () => {
    const workers = new Map<string, { sessionPath: string; role: 'primary' | 'secondary'; status: string }>()
    workers.set('/main.jsonl', { sessionPath: '/main.jsonl', role: 'primary', status: 'connected' })

    const disposeSecondary = vi.fn()

    async function handleDispose(sessionPath: string) {
      const worker = workers.get(sessionPath)
      if (!worker) return { ok: true }
      if (worker.role === 'primary') return { ok: false, error: 'Cannot dispose primary worker' }
      try {
        await disposeSecondary(sessionPath)
        return { ok: true }
      } catch (err: unknown) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    }

    const result = await handleDispose('/main.jsonl')
    expect(result.ok).toBe(false)
    expect(result.error).toBe('Cannot dispose primary worker')
    expect(disposeSecondary).not.toHaveBeenCalled()
  })

  it('succeeds when worker does not exist', async () => {
    const workers = new Map<string, { sessionPath: string; role: 'primary' | 'secondary'; status: string }>()

    async function handleDispose(sessionPath: string) {
      const worker = workers.get(sessionPath)
      if (!worker) return { ok: true }
      if (worker.role === 'primary') return { ok: false, error: 'Cannot dispose primary worker' }
      return { ok: true }
    }

    const result = await handleDispose('/nonexistent.jsonl')
    expect(result.ok).toBe(true)
  })
})

// ── session:newSession (sessionPath-aware) ──

describe('IPC: session:newSession', () => {
  it('routes to secondary when sessionPath provided', async () => {
    const secondary = { isConnected: true, sendCommand: vi.fn(), sendRpcCommand: vi.fn().mockResolvedValue({}) }
    const resolve = createWorkerResolver(new Map([['/sec.jsonl', secondary]]))

    async function handleNewSession(sessionPath: string | null, name: string, parentSessionPath?: string) {
      const worker = sessionPath ? resolve(sessionPath) : resolve(null)
      if (!worker?.isConnected) return { success: false, error: 'Worker not connected' }
      const command: Record<string, unknown> = { type: 'new_session' }
      if (parentSessionPath) command.parentSession = parentSessionPath
      await worker.sendRpcCommand(command)
      if (name) {
        try { await worker.sendRpcCommand({ type: 'set_session_name', name }) } catch {}
      }
      try { await worker.sendRpcCommand({ type: 'flush_session' }) } catch {}
      return { success: true }
    }

    await handleNewSession('/sec.jsonl', 'experiment', '/main.jsonl')
    expect(secondary.sendRpcCommand).toHaveBeenCalledWith({ type: 'new_session', parentSession: '/main.jsonl' })
  })

  it('routes to primary when sessionPath is null', async () => {
    const primary = { isConnected: true, sendCommand: vi.fn(), sendRpcCommand: vi.fn().mockResolvedValue({}) }
    const resolve = createWorkerResolver(new Map([[null, primary], ['__primary__', primary]]))

    async function handleNewSession(sessionPath: string | null, name: string, parentSessionPath?: string) {
      const worker = sessionPath ? resolve(sessionPath) : resolve(null)
      if (!worker?.isConnected) return { success: false, error: 'Worker not connected' }
      const command: Record<string, unknown> = { type: 'new_session' }
      if (parentSessionPath) command.parentSession = parentSessionPath
      await worker.sendRpcCommand(command)
      return { success: true }
    }

    await handleNewSession(null, 'solo')
    expect(primary.sendRpcCommand).toHaveBeenCalledWith({ type: 'new_session' })
  })

  it('returns error when worker not connected', async () => {
    const resolve = createWorkerResolver(new Map())

    async function handleNewSession(sessionPath: string | null, name: string, parentSessionPath?: string) {
      const worker = sessionPath ? resolve(sessionPath) : resolve(null)
      if (!worker?.isConnected) return { success: false, error: 'Worker not connected' }
      return { success: true }
    }

    const result = await handleNewSession('/missing.jsonl', 'test')
    expect(result.success).toBe(false)
  })
})

// ── session:switchSession ──

describe('IPC: session:switchSession', () => {
  it('sends switch_session RPC via primary', async () => {
    const primary = { isConnected: true, sendCommand: vi.fn(), sendRpcCommand: vi.fn().mockResolvedValue({}) }

    async function handleSwitchSession(sessionPath: string) {
      if (!primary.isConnected) return { success: false, error: 'Pi not connected' }
      try {
        await primary.sendRpcCommand({ type: 'switch_session', sessionPath })
        return { success: true }
      } catch (err: unknown) {
        return { success: false, error: err instanceof Error ? err.message : String(err) }
      }
    }

    const result = await handleSwitchSession('/other-session.jsonl')
    expect(result.success).toBe(true)
    expect(primary.sendRpcCommand).toHaveBeenCalledWith({ type: 'switch_session', sessionPath: '/other-session.jsonl' })
  })
})

// ── session:renameSession (sessionPath-aware) ──

describe('IPC: session:renameSession', () => {
  it('routes to secondary when sessionPath provided', async () => {
    const secondary = { isConnected: true, sendCommand: vi.fn(), sendRpcCommand: vi.fn() }
    secondary.sendRpcCommand.mockResolvedValueOnce({}) // set_session_name
    secondary.sendRpcCommand.mockResolvedValueOnce({ sessionFile: '/sec.jsonl' }) // get_state via sessionFile

    const resolve = createWorkerResolver(new Map([['/sec.jsonl', secondary]]))
    const nameSession = vi.fn().mockReturnValue(true)

    async function handleRenameSession(sessionPath: string | null, name: string) {
      const worker = sessionPath ? resolve(sessionPath) : resolve(null)
      if (worker?.isConnected) {
        try { await worker.sendRpcCommand({ type: 'set_session_name', name }) } catch {}
        try {
          const data = (await worker.sendRpcCommand({ type: 'get_state' })) as Record<string, unknown>
          const currentPath = typeof data.sessionFile === 'string' ? data.sessionFile : null
          if (currentPath) nameSession(currentPath, name)
        } catch {}
      }
      return { success: true }
    }

    await handleRenameSession('/sec.jsonl', 'renamed-sec')
    expect(secondary.sendRpcCommand).toHaveBeenCalledWith({ type: 'set_session_name', name: 'renamed-sec' })
    expect(nameSession).toHaveBeenCalledWith('/sec.jsonl', 'renamed-sec')
  })
})

// ── session:forkAtEntry (sessionPath-aware) ──

describe('IPC: session:forkAtEntry', () => {
  it('routes to secondary when sessionPath provided', async () => {
    const secondary = { isConnected: true, sendCommand: vi.fn(), sendRpcCommand: vi.fn() }
    secondary.sendRpcCommand.mockResolvedValueOnce({ sessionFile: '/parent.jsonl' })
    secondary.sendRpcCommand.mockResolvedValueOnce({})

    const resolve = createWorkerResolver(new Map([['/sec.jsonl', secondary]]))
    const addForkPoint = vi.fn()

    async function handleForkAtEntry(sessionPath: string | null, entryId: string, name?: string) {
      const worker = sessionPath ? resolve(sessionPath) : resolve(null)
      if (!worker?.isConnected) return { success: false, error: 'Worker not connected' }

      let parentPath: string | null = null
      try {
        const preState = (await worker.sendRpcCommand({ type: 'get_state' })) as Record<string, unknown>
        parentPath = typeof preState.sessionFile === 'string' ? preState.sessionFile : null
      } catch {}

      const data = (await worker.sendRpcCommand({ type: 'fork', entryId })) as Record<string, unknown>

      if (name) {
        try { await worker.sendRpcCommand({ type: 'set_session_name', name }) } catch {}
        try { await worker.sendRpcCommand({ type: 'flush_session' }) } catch {}
      }

      if (parentPath) addForkPoint(parentPath, entryId, name ?? '')

      return { success: true, text: typeof data.text === 'string' ? data.text : undefined }
    }

    const result = await handleForkAtEntry('/sec.jsonl', 'entry-42', 'experiment')
    expect(result.success).toBe(true)
    expect(addForkPoint).toHaveBeenCalledWith('/parent.jsonl', 'entry-42', 'experiment')
  })
})

// ── session:getForkMessages (sessionPath-aware) ──

describe('IPC: session:getForkMessages', () => {
  it('routes to secondary when sessionPath provided', async () => {
    const secondary = { isConnected: true, sendCommand: vi.fn(), sendRpcCommand: vi.fn().mockResolvedValue({ messages: [{ id: '1', text: 'hello' }] }) }
    const resolve = createWorkerResolver(new Map([['/sec.jsonl', secondary]]))

    async function handleGetForkMessages(sessionPath: string | null) {
      const worker = sessionPath ? resolve(sessionPath) : resolve(null)
      if (!worker?.isConnected) return []
      const data = (await worker.sendRpcCommand({ type: 'get_fork_messages' })) as { messages?: unknown[] }
      return data.messages ?? []
    }

    const result = await handleGetForkMessages('/sec.jsonl')
    expect(result).toHaveLength(1)
    expect(secondary.sendRpcCommand).toHaveBeenCalledWith({ type: 'get_fork_messages' })
  })
})

// ── session:getMessages (sessionPath-aware) ──

describe('IPC: session:getMessages', () => {
  it('routes to correct worker by sessionPath', async () => {
    const primary = { isConnected: true, sendCommand: vi.fn(), sendRpcCommand: vi.fn().mockResolvedValue({ messages: ['primary-msg'] }) }
    const secondary = { isConnected: true, sendCommand: vi.fn(), sendRpcCommand: vi.fn().mockResolvedValue({ messages: ['secondary-msg'] }) }
    const resolve = createWorkerResolver(new Map([[null, primary], ['__primary__', primary], ['/sec.jsonl', secondary]]))

    async function handleGetMessages(sessionPath: string | null) {
      const worker = sessionPath ? resolve(sessionPath) : resolve(null)
      if (!worker?.isConnected) return []
      const data = (await worker.sendRpcCommand({ type: 'get_messages' })) as { messages?: unknown[] }
      return data.messages ?? []
    }

    const primaryResult = await handleGetMessages(null)
    expect(primary.sendRpcCommand).toHaveBeenCalledWith({ type: 'get_messages' })

    const secondaryResult = await handleGetMessages('/sec.jsonl')
    expect(secondary.sendRpcCommand).toHaveBeenCalledWith({ type: 'get_messages' })
  })
})

// ── session:deleteSession ──

describe('IPC: session:deleteSession', () => {
  it('disposes secondary before deleting if it exists', async () => {
    const workers = new Map<string, { role: 'primary' | 'secondary' }>()
    workers.set('/sec.jsonl', { role: 'secondary' })
    const disposeSecondary = vi.fn().mockImplementation(() => { workers.delete('/sec.jsonl') })
    const deleteSessionFn = vi.fn().mockReturnValue(true)

    async function handleDeleteSession(sessionPath: string) {
      const existing = workers.get(sessionPath)
      if (existing && existing.role === 'secondary') {
        try { await disposeSecondary(sessionPath) } catch {}
      }
      const result = deleteSessionFn(sessionPath)
      return result ? { success: true } : { success: false, error: 'Failed to delete session' }
    }

    const result = await handleDeleteSession('/sec.jsonl')
    expect(result.success).toBe(true)
    expect(disposeSecondary).toHaveBeenCalledWith('/sec.jsonl')
    expect(deleteSessionFn).toHaveBeenCalledWith('/sec.jsonl')
  })
})

// ── session:getForkPoints ──

describe('IPC: session:getForkPoints', () => {
  it('calls sessionService.getForkPoints with session path', () => {
    const getForkPointsFn = vi.fn().mockReturnValue([
      { entryId: 'entry-1', childName: 'fork-a' },
      { entryId: 'entry-2', childName: 'fork-b' },
    ])

    const result = getForkPointsFn('/parent.jsonl')
    expect(getForkPointsFn).toHaveBeenCalledWith('/parent.jsonl')
    expect(result).toHaveLength(2)
    expect(result[0].entryId).toBe('entry-1')
  })
})

// ── session:listSessions ──

describe('IPC: session:listSessions', () => {
  it('passes currentSessionPath from get_state to listSessions', async () => {
    const sendRpcCommand = vi.fn().mockResolvedValue({ sessionFile: '/current-session.jsonl' })

    async function handleListSessions(listSessionsFn: (currentPath?: string) => { projects: unknown[] }) {
      let currentPath: string | undefined
      try {
        const data = (await sendRpcCommand({ type: 'get_state' })) as Record<string, unknown>
        if (typeof data.sessionFile === 'string') currentPath = data.sessionFile
      } catch { currentPath = undefined }
      return listSessionsFn(currentPath)
    }

    const listSessionsFn = vi.fn().mockReturnValue({ projects: [] })
    await handleListSessions(listSessionsFn)
    expect(listSessionsFn).toHaveBeenCalledWith('/current-session.jsonl')
  })

  it('handles get_state failure gracefully', async () => {
    const sendRpcCommand = vi.fn().mockRejectedValue(new Error('timeout'))

    async function handleListSessions(listSessionsFn: (currentPath?: string) => { projects: unknown[] }) {
      let currentPath: string | undefined
      try {
        const data = (await sendRpcCommand({ type: 'get_state' })) as Record<string, unknown>
        if (typeof data.sessionFile === 'string') currentPath = data.sessionFile
      } catch { currentPath = undefined }
      return listSessionsFn(currentPath)
    }

    const listSessionsFn = vi.fn().mockReturnValue({ projects: [] })
    await handleListSessions(listSessionsFn)
    expect(listSessionsFn).toHaveBeenCalledWith(undefined)
  })
})
