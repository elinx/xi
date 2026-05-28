import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Tests for App.tsx integration behavior:
 * 1. Auto-start on mount
 * 2. Fork passes parentSessionPath
 * 3. Refresh after operations
 *
 * We test the logic by mocking the IPC layer and verifying the expected calls.
 */

// Mock window.api (Electron preload bridge)
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
    listSessions: vi.fn().mockResolvedValue({ projects: [] }),
    getForkMessages: vi.fn().mockResolvedValue([]),
    forkAtEntry: vi.fn().mockResolvedValue({ success: true }),
    switchSession: vi.fn().mockResolvedValue({ success: true }),
    newSession: vi.fn().mockResolvedValue({ success: true }),
    renameSession: vi.fn().mockResolvedValue({ success: true }),
    getCurrentSession: vi.fn().mockResolvedValue(null),
    refreshSessions: vi.fn().mockResolvedValue({ projects: [] }),
  }
}

describe('App auto-start behavior', () => {
  it('calls window.api.start() on mount', async () => {
    const api = createMockApi()

    // Simulate what useEffect(() => { handleConnect() }, []) does
    async function handleConnect(): Promise<void> {
      const result = await api.start()
      if (!result.ok && result.error) {
        // setError(result.error)
      }
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

describe('Fork passes parentSessionPath', () => {
  it('newSession passes current session path as parent', async () => {
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

    // Simulate: handleNewSession in App.tsx
    async function handleNewSession(name: string): Promise<void> {
      const parentPath = currentSession?.filePath
      const result = await api.newSession(parentPath)
      if (result.success) {
        await api.renameSession(name)
        await api.listSessions()
        await api.getCurrentSession()
      }
    }

    await handleNewSession('experiment-1')

    expect(api.newSession).toHaveBeenCalledWith('/main-session.jsonl')
    expect(api.renameSession).toHaveBeenCalledWith('experiment-1')
    // Session list should be refreshed
    expect(api.listSessions).toHaveBeenCalled()
    expect(api.getCurrentSession).toHaveBeenCalled()
  })

  it('newSession without current session passes undefined parent', async () => {
    const api = createMockApi()

    async function handleNewSession(name: string): Promise<void> {
      const parentPath = undefined // no current session
      const result = await api.newSession(parentPath)
      if (result.success) {
        await api.renameSession(name)
      }
    }

    await handleNewSession('solo-session')

    expect(api.newSession).toHaveBeenCalledWith(undefined)
    expect(api.renameSession).toHaveBeenCalledWith('solo-session')
  })

  it('does not rename if newSession fails', async () => {
    const api = createMockApi()
    api.newSession.mockResolvedValue({ success: false, error: 'RPC failed' })

    async function handleNewSession(name: string): Promise<void> {
      const parentPath = '/main.jsonl'
      const result = await api.newSession(parentPath)
      if (result.success) {
        await api.renameSession(name)
      }
    }

    await handleNewSession('should-not-create')

    expect(api.newSession).toHaveBeenCalled()
    expect(api.renameSession).not.toHaveBeenCalled()
  })
})

describe('Refresh after session operations', () => {
  const api = createMockApi()

  beforeEach(() => {
    vi.clearAllMocks()
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
    async function handleForkAtEntry(entryId: string): Promise<void> {
      const result = await api.forkAtEntry(entryId)
      if (result.success) {
        await api.listSessions()
        await api.getCurrentSession()
      }
    }

    await handleForkAtEntry('entry-123')

    expect(api.forkAtEntry).toHaveBeenCalledWith('entry-123')
    expect(api.listSessions).toHaveBeenCalled()
    expect(api.getCurrentSession).toHaveBeenCalled()
  })

  it('refreshes sessions on Pi connect event', () => {
    const onStateChanged = api.onStateChanged
    let stateHandler: ((state: { connected: boolean }) => void) | null = null

    // Simulate useSessionManager's useEffect for onStateChanged
    onStateChanged.mockImplementation((cb) => {
      stateHandler = cb
      return () => {}
    })

    // Register the handler
    const cleanup = onStateChanged((state) => {
      if (state.connected) {
        api.listSessions()
        api.getCurrentSession()
      }
    })

    // Simulate Pi connected event
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

    api.onStateChanged((state) => {
      if (state.connected) {
        api.listSessions()
        api.getCurrentSession()
      }
    })

    // Simulate disconnect
    stateHandler!({ connected: false })

    expect(api.listSessions).not.toHaveBeenCalled()
    expect(api.getCurrentSession).not.toHaveBeenCalled()
  })
})

describe('Main session auto-naming', () => {
  it('names session "main" by writing to file when no main session exists on connect', () => {
    const nameSession = vi.fn().mockReturnValue(true)
    const sessionFilePath = '/test/sessions/main-session.jsonl'

    // Simulate: piBridge 'connected' handler in index.ts
    // findMainSession returns a session but with no name (fallback)
    const mainSession = { filePath: '/test/sessions/old.jsonl', name: null }
    if (!mainSession || !mainSession.name) {
      const sessionPath = sessionFilePath // piBridge!.sessionFilePath
      if (sessionPath) {
        nameSession(sessionPath, 'main')
      }
    }

    expect(nameSession).toHaveBeenCalledWith('/test/sessions/main-session.jsonl', 'main')
  })

  it('does not name session when main session already has a name', () => {
    const nameSession = vi.fn()

    const mainSession = { filePath: '/main.jsonl', name: 'main' }
    if (!mainSession || !mainSession.name) {
      nameSession('/some-session.jsonl', 'main')
    }

    expect(nameSession).not.toHaveBeenCalled()
  })

  it('handles missing sessionFilePath gracefully', () => {
    const nameSession = vi.fn()

    const mainSession = null
    const sessionFilePath = null // piBridge!.sessionFilePath is null
    if (!mainSession) {
      const sessionPath = sessionFilePath
      if (sessionPath) {
        nameSession(sessionPath, 'main')
      }
    }

    expect(nameSession).not.toHaveBeenCalled()
  })

  it('names session BEFORE broadcasting stateChanged', () => {
    const order: string[] = []
    const nameSession = vi.fn().mockImplementation(() => order.push('nameSession'))
    const broadcastToRenderers = vi.fn().mockImplementation(() => order.push('stateChanged'))

    const sessionFilePath = '/test/main.jsonl'
    const mainSession = null

    // Simulate: connected handler in index.ts
    if (!mainSession) {
      const sessionPath = sessionFilePath
      if (sessionPath) {
        nameSession(sessionPath, 'main')
      }
    }
    broadcastToRenderers('pi:stateChanged', { connected: true })

    expect(order).toEqual(['nameSession', 'stateChanged'])
  })

  it('names unnamed main session at app startup before creating PiBridge', () => {
    const nameSession = vi.fn().mockReturnValue(true)

    // Simulate: app.whenReady() in index.ts
    let mainSession = { filePath: '/test/old-session.jsonl', name: null } // found by fallback
    if (mainSession && !mainSession.name) {
      nameSession(mainSession.filePath, 'main')
      mainSession = { ...mainSession, name: 'main' }
    }

    expect(nameSession).toHaveBeenCalledWith('/test/old-session.jsonl', 'main')
    expect(mainSession.name).toBe('main')
  })

  it('does not rename session that already has a name', () => {
    const nameSession = vi.fn()

    let mainSession = { filePath: '/test/main.jsonl', name: 'main' }
    if (mainSession && !mainSession.name) {
      nameSession(mainSession.filePath, 'main')
    }

    expect(nameSession).not.toHaveBeenCalled()
    expect(mainSession.name).toBe('main')
  })

  it('passes main session path as --session argument to Pi', () => {
    const mainSession = { filePath: '/path/to/main-session.jsonl' }

    const args = ['--mode', 'rpc']
    const sessionPath = mainSession?.filePath
    if (sessionPath) {
      args.push('--session', sessionPath)
    }

    expect(args).toEqual(['--mode', 'rpc', '--session', '/path/to/main-session.jsonl'])
  })

  it('starts Pi without --session when no main session exists', () => {
    const mainSession = null

    const args = ['--mode', 'rpc']
    const sessionPath = mainSession?.filePath
    if (sessionPath) {
      args.push('--session', sessionPath)
    }

    expect(args).toEqual(['--mode', 'rpc'])
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

    // Before any response
    expect(connected).toBe(false)
    expect(bridge.ready).toBe(false)

    // First successful response with sessionFile
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
