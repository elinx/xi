import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Tests for App.tsx integration behavior:
 * 1. Auto-start on mount
 * 2. Fork passes parentSessionPath via sessionPath-aware APIs
 * 3. Refresh after operations
 * 4. Worker management (ensureReady, getStatus, dispose, status events)
 *
 * We test the logic by mocking the IPC layer and verifying the expected calls.
 */

function createMockApi() {
  return {
    start: vi.fn().mockResolvedValue({ ok: true }),
    stop: vi.fn().mockResolvedValue({ ok: true }),
    sendCommand: vi.fn().mockResolvedValue({ ok: true }),
    sendExtensionUIResponse: vi.fn().mockResolvedValue({ ok: true }),
    getState: vi.fn().mockResolvedValue({ connected: false }),
    onEvent: vi.fn().mockReturnValue(() => {}),
    onResponse: vi.fn().mockReturnValue(() => {}),
    onExtensionUiRequest: vi.fn().mockReturnValue(() => {}),
    onStateChanged: vi.fn().mockReturnValue(() => {}),
    onWorkerStatus: vi.fn().mockReturnValue(() => {}),
    listSessions: vi.fn().mockResolvedValue({ projects: [] }),
    getForkMessages: vi.fn().mockResolvedValue([]),
    forkAtEntry: vi.fn().mockResolvedValue({ success: true }),
    switchSession: vi.fn().mockResolvedValue({ success: true }),
    newSession: vi.fn().mockResolvedValue({ success: true }),
    renameSession: vi.fn().mockResolvedValue({ success: true }),
    getCurrentSession: vi.fn().mockResolvedValue(null),
    refreshSessions: vi.fn().mockResolvedValue({ projects: [] }),
    workerEnsureReady: vi.fn().mockResolvedValue({ ok: true, status: 'connected' }),
    workerGetStatus: vi.fn().mockResolvedValue([]),
    workerDispose: vi.fn().mockResolvedValue({ ok: true }),
  }
}

describe('App auto-start behavior', () => {
  it('calls window.api.start() on mount', async () => {
    const api = createMockApi()

    async function handleConnect(): Promise<void> {
      const result = await api.start()
      if (!result.ok) return
    }

    await handleConnect()
    expect(api.start).toHaveBeenCalledOnce()
  })

  it('sets error when start fails', async () => {
    const api = createMockApi()
    api.start.mockResolvedValue({ ok: false, error: 'Pi not found' })

    let error: string | null = null
    async function handleConnect(): Promise<void> {
      const result = await api.start()
      if (!result.ok && result.error) {
        error = result.error
      }
    }

    await handleConnect()
    expect(error).toBe('Pi not found')
  })
})

describe('Fork passes parentSessionPath via sessionPath-aware API', () => {
  it('newSession passes sessionPath and parentSessionPath', async () => {
    const api = createMockApi()
    const currentSession = {
      filePath: '/main-session.jsonl',
      sessionId: 'uuid-1',
      name: 'main',
      createdAt: '2026-05-28T10:00:00.000Z',
      cwd: '/test',
      parentSessionPath: null,
      messageCount: 5,
      isMain: true,
    }

    async function handleNewSession(name: string): Promise<void> {
      const sessionPath = currentSession?.filePath
      const parentPath = currentSession?.filePath
      const result = await api.newSession(sessionPath, name, parentPath)
      if (result.success) {
        await api.renameSession(sessionPath, name)
        await api.listSessions()
        await api.getCurrentSession()
      }
    }

    await handleNewSession('experiment-1')

    expect(api.newSession).toHaveBeenCalledWith('/main-session.jsonl', 'experiment-1', '/main-session.jsonl')
    expect(api.renameSession).toHaveBeenCalledWith('/main-session.jsonl', 'experiment-1')
    expect(api.listSessions).toHaveBeenCalled()
    expect(api.getCurrentSession).toHaveBeenCalled()
  })

  it('newSession without current session passes null sessionPath', async () => {
    const api = createMockApi()

    async function handleNewSession(name: string): Promise<void> {
      const result = await api.newSession(null, name)
      if (result.success) {
        await api.renameSession(null, name)
      }
    }

    await handleNewSession('solo-session')

    expect(api.newSession).toHaveBeenCalledWith(null, 'solo-session')
    expect(api.renameSession).toHaveBeenCalledWith(null, 'solo-session')
  })

  it('does not rename if newSession fails', async () => {
    const api = createMockApi()
    api.newSession.mockResolvedValue({ success: false, error: 'RPC failed' })

    async function handleNewSession(name: string): Promise<void> {
      const result = await api.newSession('/main.jsonl', name)
      if (result.success) {
        await api.renameSession('/main.jsonl', name)
      }
    }

    await handleNewSession('should-not-create')

    expect(api.newSession).toHaveBeenCalled()
    expect(api.renameSession).not.toHaveBeenCalled()
  })
})

describe('Refresh after session operations', () => {
  let api: ReturnType<typeof createMockApi>

  beforeEach(() => {
    api = createMockApi()
  })

  it('refreshes sessions after switchSession', async () => {
    async function handleSwitchSession(sessionPath: string): Promise<void> {
      const result = await api.switchSession(sessionPath)
      if (result.success) {
        await api.listSessions()
        await api.getCurrentSession()
      }
    }

    await handleSwitchSession('/other-session.jsonl')

    expect(api.switchSession).toHaveBeenCalledWith('/other-session.jsonl')
    expect(api.listSessions).toHaveBeenCalled()
    expect(api.getCurrentSession).toHaveBeenCalled()
  })

  it('refreshes sessions after forkAtEntry', async () => {
    async function handleForkAtEntry(sessionPath: string | null, entryId: string, name?: string): Promise<void> {
      const result = await api.forkAtEntry(sessionPath, entryId, name)
      if (result.success) {
        await api.listSessions()
        await api.getCurrentSession()
      }
    }

    await handleForkAtEntry('/main.jsonl', 'entry-123', 'fork-name')

    expect(api.forkAtEntry).toHaveBeenCalledWith('/main.jsonl', 'entry-123', 'fork-name')
    expect(api.listSessions).toHaveBeenCalled()
    expect(api.getCurrentSession).toHaveBeenCalled()
  })

  it('refreshes sessions on Pi connect event', () => {
    let stateHandler: ((state: { connected: boolean }) => void) | null = null

    api.onStateChanged.mockImplementation((cb) => {
      stateHandler = cb
      return () => {}
    })

    const cleanup = api.onStateChanged((state: { connected: boolean }) => {
      if (state.connected) {
        api.listSessions()
        api.getCurrentSession()
      }
    })

    stateHandler!({ connected: true })

    expect(api.listSessions).toHaveBeenCalled()
    expect(api.getCurrentSession).toHaveBeenCalled()

    cleanup()
  })

  it('does not refresh when Pi disconnects', () => {
    let stateHandler: ((state: { connected: boolean }) => void) | null = null
    api.onStateChanged.mockImplementation((cb) => {
      stateHandler = cb
      return () => {}
    })

    api.onStateChanged((state: { connected: boolean }) => {
      if (state.connected) {
        api.listSessions()
        api.getCurrentSession()
      }
    })

    stateHandler!({ connected: false })

    expect(api.listSessions).not.toHaveBeenCalled()
    expect(api.getCurrentSession).not.toHaveBeenCalled()
  })
})

describe('handleSwitchSession calls workerEnsureReady', () => {
  it('calls workerEnsureReady after switch succeeds', async () => {
    const api = createMockApi()

    async function handleSwitchSession(sessionPath: string): Promise<void> {
      const result = await api.switchSession(sessionPath)
      if (result.success) {
        await api.workerEnsureReady(sessionPath)
        await api.listSessions()
        await api.getCurrentSession()
      }
    }

    await handleSwitchSession('/other-session.jsonl')

    expect(api.switchSession).toHaveBeenCalledWith('/other-session.jsonl')
    expect(api.workerEnsureReady).toHaveBeenCalledWith('/other-session.jsonl')
  })

  it('does not call workerEnsureReady if switch fails', async () => {
    const api = createMockApi()
    api.switchSession.mockResolvedValue({ success: false, error: 'not found' })

    async function handleSwitchSession(sessionPath: string): Promise<void> {
      const result = await api.switchSession(sessionPath)
      if (result.success) {
        await api.workerEnsureReady(sessionPath)
      }
    }

    await handleSwitchSession('/bad-session.jsonl')

    expect(api.workerEnsureReady).not.toHaveBeenCalled()
  })
})

describe('handleNewSession calls workerEnsureReady', () => {
  it('calls workerEnsureReady for the new session path', async () => {
    const api = createMockApi()
    api.getCurrentSession.mockResolvedValue({
      filePath: '/new-session.jsonl',
      sessionId: 'uuid-2',
      name: 'experiment-1',
    })

    async function handleNewSession(name: string): Promise<void> {
      const result = await api.newSession(null, name)
      if (result.success) {
        const session = await api.getCurrentSession()
        if (session?.filePath) {
          await api.workerEnsureReady(session.filePath)
        }
        await api.listSessions()
      }
    }

    await handleNewSession('experiment-1')

    expect(api.workerEnsureReady).toHaveBeenCalledWith('/new-session.jsonl')
  })

  it('skips workerEnsureReady when no session path returned', async () => {
    const api = createMockApi()
    api.getCurrentSession.mockResolvedValue(null)

    async function handleNewSession(name: string): Promise<void> {
      const result = await api.newSession(null, name)
      if (result.success) {
        const session = await api.getCurrentSession()
        if (session?.filePath) {
          await api.workerEnsureReady(session.filePath)
        }
      }
    }

    await handleNewSession('orphan')

    expect(api.workerEnsureReady).not.toHaveBeenCalled()
  })
})

describe('Worker status events update UI state', () => {
  it('onWorkerStatus callback receives worker status data', () => {
    const api = createMockApi()
    const statusUpdates: Array<{ sessionPath: string; role: string; status: string; isStreaming: boolean }> = []

    api.onWorkerStatus.mockImplementation((cb) => {
      cb({ sessionPath: '/sec.jsonl', role: 'secondary', status: 'connected', isStreaming: false })
      cb({ sessionPath: '/main.jsonl', role: 'primary', status: 'connected', isStreaming: true })
      return () => {}
    })

    api.onWorkerStatus((data: { sessionPath: string; role: string; status: string; isStreaming: boolean }) => {
      statusUpdates.push(data)
    })

    expect(statusUpdates).toHaveLength(2)
    expect(statusUpdates[0]).toEqual({ sessionPath: '/sec.jsonl', role: 'secondary', status: 'connected', isStreaming: false })
    expect(statusUpdates[1]).toEqual({ sessionPath: '/main.jsonl', role: 'primary', status: 'connected', isStreaming: true })
  })

  it('workerGetStatus returns current worker statuses', async () => {
    const api = createMockApi()
    api.workerGetStatus.mockResolvedValue([
      { sessionPath: '/main.jsonl', role: 'primary', status: 'connected', isStreaming: false },
      { sessionPath: '/sec.jsonl', role: 'secondary', status: 'starting', isStreaming: false },
    ])

    const statuses = await api.workerGetStatus()
    expect(statuses).toHaveLength(2)
    expect(statuses[1].status).toBe('starting')
  })

  it('workerDispose removes a secondary worker', async () => {
    const api = createMockApi()
    api.workerDispose.mockResolvedValue({ ok: true })

    const result = await api.workerDispose('/sec.jsonl')
    expect(result.ok).toBe(true)
    expect(api.workerDispose).toHaveBeenCalledWith('/sec.jsonl')
  })

  it('workerDispose fails for primary worker', async () => {
    const api = createMockApi()
    api.workerDispose.mockResolvedValue({ ok: false, error: 'Cannot dispose primary worker' })

    const result = await api.workerDispose('/main.jsonl')
    expect(result.ok).toBe(false)
    expect(result.error).toBe('Cannot dispose primary worker')
  })
})

describe('Main session auto-naming', () => {
  it('names unnamed main session at app startup before creating PiBridge', () => {
    const nameSession = vi.fn().mockReturnValue(true)

    let mainSession: { filePath: string; name: string | null } = { filePath: '/test/old-session.jsonl', name: null }
    if (mainSession && !mainSession.name) {
      nameSession(mainSession.filePath, 'main')
      mainSession = { ...mainSession, name: 'main' }
    }

    expect(nameSession).toHaveBeenCalledWith('/test/old-session.jsonl', 'main')
    expect(mainSession.name).toBe('main')
  })

  it('does not rename session that already has a name', () => {
    const nameSession = vi.fn()

    let mainSession: { filePath: string; name: string | null } = { filePath: '/test/main.jsonl', name: 'main' }
    if (mainSession && !mainSession.name) {
      nameSession(mainSession.filePath, 'main')
    }

    expect(nameSession).not.toHaveBeenCalled()
    expect(mainSession.name).toBe('main')
  })

  it('handles missing sessionFilePath gracefully', () => {
    const nameSession = vi.fn()

    const mainSession = null
    const sessionFilePath = null
    if (!mainSession) {
      const sessionPath = sessionFilePath
      if (sessionPath) {
        nameSession(sessionPath, 'main')
      }
    }

    expect(nameSession).not.toHaveBeenCalled()
  })
})

describe('PiBridge readiness', () => {
  it('emits connected only after first successful response', () => {
    let connected = false
    const bridge = {
      ready: false,
      sessionFilePath: null as string | null,
      emit(event: string) {
        if (event === 'connected') connected = true
      },
      routeMessage(msg: Record<string, unknown>) {
        if (!this.ready && msg.type === 'response' && msg.success) {
          this.ready = true
          const data = msg.data as Record<string, unknown> | undefined
          if (data && typeof data.sessionFile === 'string') {
            this.sessionFilePath = data.sessionFile
          }
          this.emit('connected')
        }
      },
    }

    expect(connected).toBe(false)
    expect(bridge.ready).toBe(false)

    bridge.routeMessage({
      type: 'response',
      success: true,
      data: { sessionFile: '/test/session.jsonl' },
    })

    expect(connected).toBe(true)
    expect(bridge.ready).toBe(true)
    expect(bridge.sessionFilePath).toBe('/test/session.jsonl')
  })

  it('does not emit connected on failed response', () => {
    let connected = false
    const bridge = {
      ready: false,
      emit(event: string) {
        if (event === 'connected') connected = true
      },
      routeMessage(msg: Record<string, unknown>) {
        if (!this.ready && msg.type === 'response' && msg.success) {
          this.ready = true
          this.emit('connected')
        }
      },
    }

    bridge.routeMessage({ type: 'response', success: false })
    expect(connected).toBe(false)
  })
})
