import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'events'
import { WorkerManager } from '../src/main/worker-manager'

// ── Mock PiSDKBridge ──
// Each mock bridge instance is tracked so we can verify per-worker routing.

interface MockBridge extends EventEmitter {
  sessionId: string
  sendCommandCalls: Record<string, unknown>[]
  sendRpcCommandCalls: Record<string, unknown>[]
  rpcHandler: ((command: Record<string, unknown>) => Promise<unknown>) | null
  start(cwd: string, sessionPath?: string): Promise<void>
  stop(): Promise<void>
  sendCommand(command: Record<string, unknown>): void
  sendRpcCommand(command: Record<string, unknown>): Promise<unknown>
  sendExtensionUIResponse(response: Record<string, unknown>): void
  isConnected: boolean
}

let bridgeInstances: MockBridge[] = []
let startFnOverride: (() => Promise<void>) | undefined

function createMockBridge(sessionId: string): MockBridge {
  const bridge = new EventEmitter() as unknown as MockBridge

  const state = {
    connected: false,
    sendCommandCalls: [] as Record<string, unknown>[],
    sendRpcCommandCalls: [] as Record<string, unknown>[],
    rpcHandler: null as ((command: Record<string, unknown>) => Promise<unknown>) | null,
  }

  Object.defineProperties(bridge, {
    sessionId: { value: sessionId, writable: false },
    sendCommandCalls: { get: () => state.sendCommandCalls },
    sendRpcCommandCalls: { get: () => state.sendRpcCommandCalls },
    rpcHandler: { get: () => state.rpcHandler, set: (v: typeof state.rpcHandler) => { state.rpcHandler = v } },
    isConnected: { get: () => state.connected },
  })

  bridge.start = async (_cwd: string, _sessionPath?: string) => {
    if (startFnOverride) await startFnOverride()
    state.connected = true
  }
  bridge.stop = async () => { state.connected = false }
  bridge.sendCommand = (command: Record<string, unknown>) => { state.sendCommandCalls.push(command) }
  bridge.sendRpcCommand = async (command: Record<string, unknown>) => {
    state.sendRpcCommandCalls.push(command)
    return state.rpcHandler ? state.rpcHandler(command) : {}
  }
  bridge.sendExtensionUIResponse = (response: Record<string, unknown>) => { state.sendCommandCalls.push(response) }

  bridgeInstances.push(bridge)
  return bridge
}

// The mock class that WorkerManager instantiates via `new PiSDKBridge(sessionId)`.
// It creates a tracked MockBridge and delegates all method calls to it.
// The mock returns the MockBridge directly — WorkerManager calls bridge.on/emit/isConnected/sendCommand
// on whatever object the constructor returns. So we return the MockBridge itself.
vi.mock('../src/main/pi-sdk-bridge', () => ({
  PiSDKBridge: class {
    constructor(sessionId: string) {
      return createMockBridge(sessionId)
    }
  },
}))

// ── IPC handler logic (replicated from index.ts) ──
// These exercise real WorkerManager.get/getPrimary routing.

function resolveWorker(mgr: WorkerManager, sessionPath: string | null) {
  return sessionPath ? mgr.get(sessionPath) : mgr.getPrimary()
}

function handleSendCommand(mgr: WorkerManager, sessionPath: string | null, command: Record<string, unknown>) {
  const worker = resolveWorker(mgr, sessionPath)
  if (!worker?.bridge.isConnected) return { ok: false, error: 'Worker not connected' }
  worker.bridge.sendCommand(command)
  return { ok: true }
}

async function handleRpcCommand(mgr: WorkerManager, sessionPath: string | null, command: Record<string, unknown>) {
  const worker = resolveWorker(mgr, sessionPath)
  if (!worker?.bridge.isConnected) return { ok: false, error: 'Worker not connected' }
  try {
    const data = await worker.bridge.sendRpcCommand(command)
    return { ok: true, data }
  } catch (err: unknown) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

function handleAuthRpcCommand(mgr: WorkerManager, command: Record<string, unknown>) {
  const primary = mgr.getPrimary()
  if (!primary?.bridge.isConnected) return { ok: false, error: 'Pi not connected' }
  return primary.bridge.sendRpcCommand(command)
}

async function handleEnsureReady(mgr: WorkerManager, sessionPath: string) {
  const existing = mgr.get(sessionPath)
  if (existing && existing.status === 'connected') return { ok: true, status: 'connected' }
  if (existing && existing.status === 'starting') return { ok: true, status: 'starting' }
  if (existing && existing.status === 'error') {
    if (existing.role === 'secondary') {
      await mgr.disposeSecondary(sessionPath)
    }
  }
  try {
    const state = await mgr.getOrCreateSecondary(sessionPath, process.cwd())
    return { ok: true, status: state.status }
  } catch (err: unknown) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

async function handleDispose(mgr: WorkerManager, sessionPath: string) {
  const worker = mgr.get(sessionPath)
  if (!worker) return { ok: true }
  if (worker.role === 'primary') return { ok: false, error: 'Cannot dispose primary worker' }
  try {
    await mgr.disposeSecondary(sessionPath)
    return { ok: true }
  } catch (err: unknown) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

function handleGetStatus(mgr: WorkerManager) {
  return mgr.getAllWorkers().map(w => ({
    sessionPath: w.sessionPath,
    role: w.role,
    status: w.status,
    isStreaming: w.isStreaming,
  }))
}

// ── Helpers ──

function bridgeAt(index: number): MockBridge {
  return bridgeInstances[index]
}

// ── Tests ──

describe('Multi-worker integration', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    bridgeInstances = []
    startFnOverride = undefined
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('full session lifecycle', () => {
    it('initPrimary → getOrCreateSecondary → dispose → disposeAll', async () => {
      const mgr = new WorkerManager()

      await mgr.initPrimary('/cwd', '/main.jsonl')
      expect(mgr.getPrimary()).not.toBeNull()
      expect(mgr.getPrimary()!.role).toBe('primary')
      expect(mgr.getPrimary()!.status).toBe('connected')

      const sec = await mgr.getOrCreateSecondary('/feature.jsonl', '/cwd')
      expect(sec.role).toBe('secondary')
      expect(sec.status).toBe('connected')
      expect(mgr.get('/feature.jsonl')).toBe(sec)

      await mgr.disposeSecondary('/feature.jsonl')
      expect(mgr.get('/feature.jsonl')).toBeUndefined()

      expect(mgr.workerCount).toBe(1)
      await mgr.disposeAll()
      expect(mgr.workerCount).toBe(0)
      expect(mgr.getPrimary()).toBeNull()
    })
  })

  describe('worker routing correctness', () => {
    it('sendCommand routes to primary when sessionPath is null', async () => {
      const mgr = new WorkerManager()
      await mgr.initPrimary('/cwd')
      await mgr.getOrCreateSecondary('/sec.jsonl', '/cwd')

      const result = handleSendCommand(mgr, null, { type: 'chat', text: 'hello' })
      expect(result.ok).toBe(true)
      expect(bridgeAt(0).sendCommandCalls).toHaveLength(1)
      expect(bridgeAt(0).sendCommandCalls[0]).toEqual({ type: 'chat', text: 'hello' })
      expect(bridgeAt(1).sendCommandCalls).toHaveLength(0)
    })

    it('sendCommand routes to secondary when sessionPath provided', async () => {
      const mgr = new WorkerManager()
      await mgr.initPrimary('/cwd')
      await mgr.getOrCreateSecondary('/sec.jsonl', '/cwd')

      const result = handleSendCommand(mgr, '/sec.jsonl', { type: 'chat', text: 'secondary msg' })
      expect(result.ok).toBe(true)
      expect(bridgeAt(1).sendCommandCalls).toHaveLength(1)
      expect(bridgeAt(1).sendCommandCalls[0]).toEqual({ type: 'chat', text: 'secondary msg' })
      expect(bridgeAt(0).sendCommandCalls).toHaveLength(0)
    })

    it('sendCommand returns error for unknown sessionPath', async () => {
      const mgr = new WorkerManager()
      await mgr.initPrimary('/cwd')

      const result = handleSendCommand(mgr, '/nonexistent.jsonl', { type: 'chat' })
      expect(result.ok).toBe(false)
      expect(result.error).toBe('Worker not connected')
    })

    it('sendCommand returns error when worker is disconnected', async () => {
      const mgr = new WorkerManager()
      await mgr.initPrimary('/cwd')
      await bridgeAt(0).stop()

      const result = handleSendCommand(mgr, null, { type: 'chat' })
      expect(result.ok).toBe(false)
      expect(result.error).toBe('Worker not connected')
    })

    it('RPC commands route to correct worker by sessionPath', async () => {
      const mgr = new WorkerManager()
      await mgr.initPrimary('/cwd')
      await mgr.getOrCreateSecondary('/sec.jsonl', '/cwd')

      bridgeAt(0).rpcHandler = async (cmd) => ({ models: ['gpt-4'], source: 'primary' })
      bridgeAt(1).rpcHandler = async (cmd) => ({ models: ['claude-3'], source: 'secondary' })

      const primaryResult = await handleRpcCommand(mgr, null, { type: 'get_available_models' })
      expect(primaryResult.ok).toBe(true)
      expect((primaryResult as { ok: true; data: Record<string, unknown> }).data.source).toBe('primary')

      const secondaryResult = await handleRpcCommand(mgr, '/sec.jsonl', { type: 'get_available_models' })
      expect(secondaryResult.ok).toBe(true)
      expect((secondaryResult as { ok: true; data: Record<string, unknown> }).data.source).toBe('secondary')

      expect(bridgeAt(0).sendRpcCommandCalls).toHaveLength(1)
      expect(bridgeAt(1).sendRpcCommandCalls).toHaveLength(1)
    })
  })

  describe('auth handlers always route to primary', () => {
    it('getProviderAuthStatus uses primary even when secondary exists', async () => {
      const mgr = new WorkerManager()
      await mgr.initPrimary('/cwd')
      await mgr.getOrCreateSecondary('/sec.jsonl', '/cwd')

      bridgeAt(0).rpcHandler = async () => ({ anthropic: { configured: true } })

      const result = await handleAuthRpcCommand(mgr, { type: 'get_provider_auth_status' })
      expect(result).toEqual({ anthropic: { configured: true } })

      expect(bridgeAt(0).sendRpcCommandCalls).toHaveLength(1)
      expect(bridgeAt(1).sendRpcCommandCalls).toHaveLength(0)
    })

    it('setApiKey routes to primary only', async () => {
      const mgr = new WorkerManager()
      await mgr.initPrimary('/cwd')
      await mgr.getOrCreateSecondary('/sec.jsonl', '/cwd')

      bridgeAt(0).rpcHandler = async () => ({})

      await handleAuthRpcCommand(mgr, { type: 'set_api_key', provider: 'anthropic', apiKey: 'sk-test' })

      expect(bridgeAt(0).sendRpcCommandCalls).toHaveLength(1)
      expect(bridgeAt(1).sendRpcCommandCalls).toHaveLength(0)
    })

    it('removeAuth routes to primary only', async () => {
      const mgr = new WorkerManager()
      await mgr.initPrimary('/cwd')
      await mgr.getOrCreateSecondary('/sec.jsonl', '/cwd')

      bridgeAt(0).rpcHandler = async () => ({})

      await handleAuthRpcCommand(mgr, { type: 'remove_auth', provider: 'openai' })

      expect(bridgeAt(0).sendRpcCommandCalls).toHaveLength(1)
      expect(bridgeAt(1).sendRpcCommandCalls).toHaveLength(0)
    })

    it('registerCustomProvider routes to primary only', async () => {
      const mgr = new WorkerManager()
      await mgr.initPrimary('/cwd')
      await mgr.getOrCreateSecondary('/sec.jsonl', '/cwd')

      bridgeAt(0).rpcHandler = async () => ({})

      await handleAuthRpcCommand(mgr, { type: 'register_custom_provider', provider: 'custom', config: { baseUrl: 'https://api.custom.com' } })

      expect(bridgeAt(0).sendRpcCommandCalls).toHaveLength(1)
      expect(bridgeAt(1).sendRpcCommandCalls).toHaveLength(0)
    })

    it('returns error when primary is not connected', async () => {
      const mgr = new WorkerManager()
      const result = handleAuthRpcCommand(mgr, { type: 'get_provider_auth_status' })
      expect(result).toEqual({ ok: false, error: 'Pi not connected' })
    })
  })

  describe('worker:ensureReady', () => {
    it('returns connected for existing connected worker', async () => {
      const mgr = new WorkerManager()
      await mgr.initPrimary('/cwd')
      await mgr.getOrCreateSecondary('/sec.jsonl', '/cwd')

      const result = await handleEnsureReady(mgr, '/sec.jsonl')
      expect(result.ok).toBe(true)
      expect(result.status).toBe('connected')
    })

    it('returns starting for worker in starting state', async () => {
      const mgr = new WorkerManager()
      await mgr.initPrimary('/cwd')
      await mgr.getOrCreateSecondary('/sec.jsonl', '/cwd')
      mgr.get('/sec.jsonl')!.status = 'starting'

      const result = await handleEnsureReady(mgr, '/sec.jsonl')
      expect(result.ok).toBe(true)
      expect(result.status).toBe('starting')
    })

    it('disposes errored secondary and recreates', async () => {
      const mgr = new WorkerManager()
      await mgr.initPrimary('/cwd')
      await mgr.getOrCreateSecondary('/sec.jsonl', '/cwd')
      mgr.get('/sec.jsonl')!.status = 'error'

      const result = await handleEnsureReady(mgr, '/sec.jsonl')
      expect(result.ok).toBe(true)
      expect(result.status).toBe('connected')
    })

    it('does not dispose errored primary (ensureReady skips primary disposal)', async () => {
      const mgr = new WorkerManager()
      await mgr.initPrimary('/cwd', '/main.jsonl')
      mgr.getPrimary()!.status = 'error'

      const result = await handleEnsureReady(mgr, '/main.jsonl')
      // ensureReady skips primary disposal, creates secondary instead
      expect(mgr.getPrimary()).not.toBeNull()
      expect(mgr.getPrimary()!.role).toBe('primary')
    })

    it('creates new secondary when none exists', async () => {
      const mgr = new WorkerManager()
      await mgr.initPrimary('/cwd')

      const result = await handleEnsureReady(mgr, '/new-session.jsonl')
      expect(result.ok).toBe(true)
      expect(mgr.get('/new-session.jsonl')).toBeDefined()
      expect(mgr.get('/new-session.jsonl')!.role).toBe('secondary')
    })
  })

  describe('worker:dispose', () => {
    it('disposes a secondary worker', async () => {
      const mgr = new WorkerManager()
      await mgr.initPrimary('/cwd')
      await mgr.getOrCreateSecondary('/sec.jsonl', '/cwd')

      const result = await handleDispose(mgr, '/sec.jsonl')
      expect(result.ok).toBe(true)
      expect(mgr.get('/sec.jsonl')).toBeUndefined()
    })

    it('rejects disposal of primary', async () => {
      const mgr = new WorkerManager()
      await mgr.initPrimary('/cwd', '/main.jsonl')

      const result = await handleDispose(mgr, '/main.jsonl')
      expect(result.ok).toBe(false)
      expect(result.error).toBe('Cannot dispose primary worker')
      expect(mgr.getPrimary()).not.toBeNull()
    })

    it('no-ops for non-existent worker', async () => {
      const mgr = new WorkerManager()
      const result = await handleDispose(mgr, '/nonexistent.jsonl')
      expect(result.ok).toBe(true)
    })
  })

  describe('worker:getStatus', () => {
    it('returns all workers with correct shape', async () => {
      const mgr = new WorkerManager()
      await mgr.initPrimary('/cwd', '/main.jsonl')
      await mgr.getOrCreateSecondary('/sec.jsonl', '/cwd')

      const status = handleGetStatus(mgr)
      expect(status).toHaveLength(2)
      expect(status[0]).toEqual({
        sessionPath: '/main.jsonl',
        role: 'primary',
        status: 'connected',
        isStreaming: false,
      })
      expect(status[1]).toEqual({
        sessionPath: '/sec.jsonl',
        role: 'secondary',
        status: 'connected',
        isStreaming: false,
      })
    })

    it('returns empty array when no workers', () => {
      const mgr = new WorkerManager()
      expect(handleGetStatus(mgr)).toEqual([])
    })
  })

  describe('event propagation', () => {
    it('bridge events are forwarded through WorkerManager', async () => {
      const mgr = new WorkerManager()
      await mgr.initPrimary('/cwd')

      const events: unknown[] = []
      mgr.on('event', (data: unknown) => events.push(data))

      bridgeAt(0).emit('event', { type: 'tool_use', content: 'reading file' })

      expect(events).toHaveLength(1)
      expect(events[0]).toEqual(expect.objectContaining({ type: 'tool_use' }))
    })

    it('bridge responses are forwarded through WorkerManager', async () => {
      const mgr = new WorkerManager()
      await mgr.initPrimary('/cwd')

      const responses: unknown[] = []
      mgr.on('response', (data: unknown) => responses.push(data))

      bridgeAt(0).emit('response', { id: '1', success: true })

      expect(responses).toHaveLength(1)
    })

    it('worker:status events fire on state changes', async () => {
      const mgr = new WorkerManager()
      const statuses: unknown[] = []
      mgr.on('worker:status', (data: unknown) => statuses.push(data))

      await mgr.initPrimary('/cwd')
      await mgr.getOrCreateSecondary('/sec.jsonl', '/cwd')

      expect(statuses).toContainEqual(expect.objectContaining({ role: 'primary', status: 'connected' }))
      expect(statuses).toContainEqual(expect.objectContaining({ role: 'secondary', status: 'starting' }))
      expect(statuses).toContainEqual(expect.objectContaining({ role: 'secondary', status: 'connected' }))
    })

    it('primary disconnect triggers auto-restart', async () => {
      const mgr = new WorkerManager()
      await mgr.initPrimary('/cwd')

      bridgeAt(0).emit('disconnected')
      expect(mgr.getPrimary()!.status).toBe('error')

      await vi.advanceTimersByTimeAsync(1_000)
      expect(mgr.getPrimary()!.status).toBe('connected')
    })

    it('secondary disconnect marks error without restart', async () => {
      const mgr = new WorkerManager()
      await mgr.getOrCreateSecondary('/sec.jsonl', '/cwd')

      bridgeAt(0).emit('disconnected')

      expect(mgr.get('/sec.jsonl')!.status).toBe('error')

      await vi.advanceTimersByTimeAsync(10_000)
      expect(mgr.get('/sec.jsonl')!.status).toBe('error')
    })
  })

  describe('LRU eviction under load', () => {
    it('evicts oldest non-streaming secondary at capacity', async () => {
      const mgr = new WorkerManager()
      await mgr.initPrimary('/cwd')

      await mgr.getOrCreateSecondary('/a.jsonl', '/cwd')
      vi.advanceTimersByTime(1000)
      await mgr.getOrCreateSecondary('/b.jsonl', '/cwd')
      vi.advanceTimersByTime(1000)
      await mgr.getOrCreateSecondary('/c.jsonl', '/cwd')
      vi.advanceTimersByTime(1000)
      await mgr.getOrCreateSecondary('/d.jsonl', '/cwd')

      expect(mgr.workerCount).toBe(5)

      await mgr.getOrCreateSecondary('/e.jsonl', '/cwd')

      expect(mgr.get('/a.jsonl')).toBeUndefined()
      expect(mgr.get('/e.jsonl')).toBeDefined()
      expect(mgr.workerCount).toBe(5)
    })

    it('evicted worker has stop() called', async () => {
      const mgr = new WorkerManager()
      await mgr.initPrimary('/cwd')

      await mgr.getOrCreateSecondary('/old.jsonl', '/cwd')
      const oldBridge = bridgeAt(1)
      const stopSpy = vi.spyOn(oldBridge, 'stop')

      vi.advanceTimersByTime(1000)
      await mgr.getOrCreateSecondary('/b.jsonl', '/cwd')
      vi.advanceTimersByTime(1000)
      await mgr.getOrCreateSecondary('/c.jsonl', '/cwd')
      vi.advanceTimersByTime(1000)
      await mgr.getOrCreateSecondary('/d.jsonl', '/cwd')

      await mgr.getOrCreateSecondary('/e.jsonl', '/cwd')

      expect(stopSpy).toHaveBeenCalled()
    })

    it('skips streaming workers during eviction', async () => {
      const mgr = new WorkerManager()
      await mgr.initPrimary('/cwd')

      await mgr.getOrCreateSecondary('/streaming.jsonl', '/cwd')
      vi.advanceTimersByTime(1000)
      await mgr.getOrCreateSecondary('/idle.jsonl', '/cwd')
      vi.advanceTimersByTime(1000)
      await mgr.getOrCreateSecondary('/c.jsonl', '/cwd')
      vi.advanceTimersByTime(1000)
      await mgr.getOrCreateSecondary('/d.jsonl', '/cwd')

      mgr.get('/streaming.jsonl')!.isStreaming = true

      await mgr.getOrCreateSecondary('/e.jsonl', '/cwd')

      expect(mgr.get('/streaming.jsonl')).toBeDefined()
      expect(mgr.get('/idle.jsonl')).toBeUndefined()
    })
  })
})
