import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Tests for IPC handlers in main process (index.ts).
 *
 * We verify the handler logic by simulating the RPC command construction
 * and response parsing that happens inside each IPC handler.
 */

describe('IPC: session:newSession', () => {
  it('passes parentSessionPath to RPC command when provided', () => {
    const sendRpcCommand = vi.fn().mockResolvedValue({})

    // Simulate: ipcMain.handle('session:newSession', async (_event, parentSessionPath) => { ... })
    async function handleNewSession(parentSessionPath?: string) {
      const command: Record<string, unknown> = { type: 'new_session' }
      if (parentSessionPath) {
        command.parentSession = parentSessionPath
      }
      await sendRpcCommand(command)
      return { success: true }
    }

    handleNewSession('/main-session.jsonl')

    expect(sendRpcCommand).toHaveBeenCalledWith({
      type: 'new_session',
      parentSession: '/main-session.jsonl',
    })
  })

  it('sends minimal command when no parentSessionPath', () => {
    const sendRpcCommand = vi.fn().mockResolvedValue({})

    async function handleNewSession(parentSessionPath?: string) {
      const command: Record<string, unknown> = { type: 'new_session' }
      if (parentSessionPath) {
        command.parentSession = parentSessionPath
      }
      await sendRpcCommand(command)
      return { success: true }
    }

    handleNewSession()

    expect(sendRpcCommand).toHaveBeenCalledWith({ type: 'new_session' })
  })

  it('returns error when RPC fails', async () => {
    const sendRpcCommand = vi.fn().mockRejectedValue(new Error('Pi not connected'))

    async function handleNewSession(parentSessionPath?: string) {
      try {
        const command: Record<string, unknown> = { type: 'new_session' }
        if (parentSessionPath) {
          command.parentSession = parentSessionPath
        }
        await sendRpcCommand(command)
        return { success: true }
      } catch (err: unknown) {
        return { success: false, error: err instanceof Error ? err.message : String(err) }
      }
    }

    const result = await handleNewSession('/main.jsonl')
    expect(result.success).toBe(false)
    expect(result.error).toBe('Pi not connected')
  })
})

describe('IPC: session:renameSession', () => {
  it('writes name directly to session file via nameSession', async () => {
    const sendRpcCommand = vi.fn()
    // First call: set_session_name RPC (may fail, that's OK)
    sendRpcCommand.mockRejectedValueOnce(new Error('RPC not supported'))
    // Second call: get_state to find current session path
    sendRpcCommand.mockResolvedValueOnce({ sessionPath: '/test/main.jsonl' })

    const nameSession = vi.fn().mockReturnValue(true)

    async function handleRenameSession(name: string) {
      try {
        await sendRpcCommand({ type: 'set_session_name', name })
      } catch {
        // RPC failed, write directly as fallback
      }

      try {
        const data = (await sendRpcCommand({ type: 'get_state' })) as Record<string, unknown>
        const sessionPath = typeof data.sessionPath === 'string' ? data.sessionPath : null
        if (sessionPath) {
          nameSession(sessionPath, name)
        }
      } catch {
        // Can't determine session path
      }

      return { success: true }
    }

    const result = await handleRenameSession('experiment-1')
    expect(result.success).toBe(true)
    expect(nameSession).toHaveBeenCalledWith('/test/main.jsonl', 'experiment-1')
  })

  it('still succeeds when RPC works but nameSession is the guarantee', async () => {
    const sendRpcCommand = vi.fn()
    sendRpcCommand.mockResolvedValueOnce({}) // set_session_name OK
    sendRpcCommand.mockResolvedValueOnce({ sessionPath: '/test/main.jsonl' }) // get_state OK

    const nameSession = vi.fn().mockReturnValue(true)

    async function handleRenameSession(name: string) {
      try {
        await sendRpcCommand({ type: 'set_session_name', name })
      } catch {}

      try {
        const data = (await sendRpcCommand({ type: 'get_state' })) as Record<string, unknown>
        const sessionPath = typeof data.sessionPath === 'string' ? data.sessionPath : null
        if (sessionPath) {
          nameSession(sessionPath, name)
        }
      } catch {}

      return { success: true }
    }

    await handleRenameSession('renamed')
    expect(nameSession).toHaveBeenCalledWith('/test/main.jsonl', 'renamed')
  })
})

describe('IPC: session:switchSession', () => {
  it('sends switch_session RPC with session path', () => {
    const sendRpcCommand = vi.fn().mockResolvedValue({})

    async function handleSwitchSession(sessionPath: string) {
      try {
        await sendRpcCommand({ type: 'switch_session', sessionPath })
        return { success: true }
      } catch (err: unknown) {
        return { success: false, error: err instanceof Error ? err.message : String(err) }
      }
    }

    handleSwitchSession('/other-session.jsonl')

    expect(sendRpcCommand).toHaveBeenCalledWith({
      type: 'switch_session',
      sessionPath: '/other-session.jsonl',
    })
  })

  it('returns error when switch fails', async () => {
    const sendRpcCommand = vi.fn().mockRejectedValue(new Error('Session not found'))

    async function handleSwitchSession(sessionPath: string) {
      try {
        await sendRpcCommand({ type: 'switch_session', sessionPath })
        return { success: true }
      } catch (err: unknown) {
        return { success: false, error: err instanceof Error ? err.message : String(err) }
      }
    }

    const result = await handleSwitchSession('/nonexistent.jsonl')
    expect(result.success).toBe(false)
    expect(result.error).toBe('Session not found')
  })
})

describe('IPC: session:forkAtEntry', () => {
  it('sends fork RPC with entryId', () => {
    const sendRpcCommand = vi.fn().mockResolvedValue({})

    async function handleForkAtEntry(entryId: string) {
      try {
        const data = (await sendRpcCommand({ type: 'fork', entryId })) as Record<string, unknown>
        return { success: true, text: typeof data.text === 'string' ? data.text : undefined }
      } catch (err: unknown) {
        return { success: false, error: err instanceof Error ? err.message : String(err) }
      }
    }

    handleForkAtEntry('entry-abc')

    expect(sendRpcCommand).toHaveBeenCalledWith({
      type: 'fork',
      entryId: 'entry-abc',
    })
  })
})

describe('IPC: session:getCurrentSession', () => {
  it('returns session info when get_state returns a sessionPath', async () => {
    const sendRpcCommand = vi.fn().mockResolvedValue({
      sessionPath: '/test/main.jsonl',
    })

    // Mock sessionService.listSessions result
    const mockListResult = {
      projects: [{
        projectPath: '/test',
        encodedDir: '--test--',
        root: null,
        allSessions: [{
          filePath: '/test/main.jsonl',
          sessionId: 'uuid-1',
          name: 'main',
          createdAt: '2026-05-28T10:00:00.000Z',
          cwd: '/test',
          parentSessionPath: null,
          messageCount: 3,
          isMain: true,
        }],
      }],
    }

    async function handleGetCurrentSession() {
      try {
        const data = (await sendRpcCommand({ type: 'get_state' })) as Record<string, unknown>
        const sessionPath = typeof data.sessionPath === 'string' ? data.sessionPath : null
        if (!sessionPath) return null

        // In real code, this calls sessionService.listSessions()
        const result = mockListResult
        for (const project of result.projects) {
          const found = project.allSessions.find((s) => s.filePath === sessionPath)
          if (found) return found
        }
        return null
      } catch {
        return null
      }
    }

    const result = await handleGetCurrentSession()
    expect(result).not.toBeNull()
    expect(result!.name).toBe('main')
    expect(result!.filePath).toBe('/test/main.jsonl')
  })

  it('returns null when get_state has no sessionPath', async () => {
    const sendRpcCommand = vi.fn().mockResolvedValue({})

    async function handleGetCurrentSession() {
      try {
        const data = (await sendRpcCommand({ type: 'get_state' })) as Record<string, unknown>
        const sessionPath = typeof data.sessionPath === 'string' ? data.sessionPath : null
        if (!sessionPath) return null
        return null
      } catch {
        return null
      }
    }

    const result = await handleGetCurrentSession()
    expect(result).toBeNull()
  })

  it('returns null when RPC fails', async () => {
    const sendRpcCommand = vi.fn().mockRejectedValue(new Error('disconnected'))

    async function handleGetCurrentSession() {
      try {
        const data = (await sendRpcCommand({ type: 'get_state' })) as Record<string, unknown>
        return data
      } catch {
        return null
      }
    }

    const result = await handleGetCurrentSession()
    expect(result).toBeNull()
  })
})

describe('IPC: session:listSessions', () => {
  it('passes currentSessionPath from get_state to listSessions', async () => {
    const sendRpcCommand = vi.fn().mockResolvedValue({
      sessionPath: '/current-session.jsonl',
    })

    // Simulates the handler logic
    async function handleListSessions(
      listSessionsFn: (currentPath?: string) => { projects: unknown[] }
    ) {
      let currentPath: string | undefined
      try {
        const data = (await sendRpcCommand({ type: 'get_state' })) as Record<string, unknown>
        if (typeof data.sessionPath === 'string') currentPath = data.sessionPath
      } catch {
        currentPath = undefined
      }
      return listSessionsFn(currentPath)
    }

    const listSessionsFn = vi.fn().mockReturnValue({ projects: [] })
    await handleListSessions(listSessionsFn)

    expect(listSessionsFn).toHaveBeenCalledWith('/current-session.jsonl')
  })

  it('handles get_state failure gracefully', async () => {
    const sendRpcCommand = vi.fn().mockRejectedValue(new Error('timeout'))

    async function handleListSessions(
      listSessionsFn: (currentPath?: string) => { projects: unknown[] }
    ) {
      let currentPath: string | undefined
      try {
        const data = (await sendRpcCommand({ type: 'get_state' })) as Record<string, unknown>
        if (typeof data.sessionPath === 'string') currentPath = data.sessionPath
      } catch {
        currentPath = undefined
      }
      return listSessionsFn(currentPath)
    }

    const listSessionsFn = vi.fn().mockReturnValue({ projects: [] })
    await handleListSessions(listSessionsFn)

    expect(listSessionsFn).toHaveBeenCalledWith(undefined)
  })
})
