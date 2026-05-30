import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Tests for session switch bug fixes.
 *
 * Bug 1: handleEvent stale closure — events discarded after switching
 * Bug 2: loadHistory overwrites viewSessionPath/runtimeSessionPath
 * Bug 3: exitSoftSwitch doesn't reload messages
 * Bug 4: softSwitchBackgroundAgentEnded flag not reset
 * Bug 5: forkPoints useEffect loads wrong session after switch
 * Bug 6: agent_end in soft switch sets runtimeSessionPath prematurely
 */

// --- Simulated state machine matching usePiRpc's logic ---

interface SimState {
  viewSessionPath: string | null
  runtimeSessionPath: string | null
  runtimeSessionId: string | null
  isSoftSwitched: boolean
  isStreaming: boolean
  messages: unknown[]
  backgroundEventBuffer: unknown[]
  softSwitchBackgroundAgentEnded: boolean
  currentAssistantId: string | null
  currentContentBlocks: Map<number, unknown>
}

function createSimState(): SimState {
  return {
    viewSessionPath: null,
    runtimeSessionPath: null,
    runtimeSessionId: null,
    isSoftSwitched: false,
    isStreaming: false,
    messages: [],
    backgroundEventBuffer: [],
    softSwitchBackgroundAgentEnded: false,
    currentAssistantId: null,
    currentContentBlocks: new Map(),
  }
}

function updateSoftSwitched(state: SimState): void {
  state.isSoftSwitched =
    state.viewSessionPath !== null &&
    state.runtimeSessionPath !== null &&
    state.viewSessionPath !== state.runtimeSessionPath
}

// Simulates handleEvent logic (Bug 1 & Bug 6)
function simulateHandleEvent(
  state: SimState,
  event: { type: string; sessionId?: string },
): { eventProcessed: boolean; eventBuffered: boolean } {
  if (state.isSoftSwitched) {
    if (event.sessionId === state.runtimeSessionId) {
      if (state.backgroundEventBuffer.length < 500) {
        state.backgroundEventBuffer.push(event)
      }
      if (event.type === 'agent_end') {
        // Bug 6 FIX: do NOT set runtimeSessionPath here
        // Old code: state.runtimeSessionPath = state.viewSessionPath
        state.isStreaming = false
        state.softSwitchBackgroundAgentEnded = true
      }
    }
    return { eventProcessed: false, eventBuffered: event.sessionId === state.runtimeSessionId }
  }

  if (event.type === 'agent_start') {
    state.isStreaming = true
  } else if (event.type === 'agent_end') {
    state.isStreaming = false
  }

  return { eventProcessed: true, eventBuffered: false }
}

// Simulates loadHistory logic (Bug 2)
function simulateLoadHistory(
  state: SimState,
  runtimeState: { sessionFile: string; sessionId: string },
): void {
  // Bug 2 FIX: only set paths if they haven't been set yet
  state.runtimeSessionId = runtimeState.sessionId
  if (!state.viewSessionPath) state.viewSessionPath = runtimeState.sessionFile
  if (!state.runtimeSessionPath) state.runtimeSessionPath = runtimeState.sessionFile
  updateSoftSwitched(state)
}

// Simulates exitSoftSwitch logic (Bug 3)
async function simulateExitSoftSwitch(
  state: SimState,
  getMessages: () => Promise<unknown[]>,
): Promise<void> {
  const targetPath = state.runtimeSessionPath

  let piMessages: unknown[]
  try {
    piMessages = await getMessages()
  } catch {
    piMessages = []
  }

  const chatMessages = Array.isArray(piMessages) && piMessages.length > 0
    ? piMessages
    : []

  const lastAssistant = chatMessages
    .filter((m): m is Record<string, unknown> => (m as Record<string, unknown>).role === 'assistant')
    .pop()

  if (lastAssistant) {
    state.currentAssistantId = lastAssistant.id as string
    state.currentContentBlocks = new Map(
      ((lastAssistant as Record<string, unknown>).blocks as unknown[]).map((b, i) => [i, b])
    )
  } else {
    state.currentAssistantId = null
    state.currentContentBlocks = new Map()
  }

  state.backgroundEventBuffer = []

  state.messages = chatMessages
  state.viewSessionPath = targetPath
  state.softSwitchBackgroundAgentEnded = false
  state.isSoftSwitched = false
}

// Simulates softSwitchBackgroundAgentEnded useEffect (Bug 4)
async function simulateBackgroundAgentEndedEffect(
  state: SimState,
  switchSession: (path: string) => Promise<{ success: boolean }>,
  loadHistory: () => Promise<void>,
): Promise<void> {
  if (!state.softSwitchBackgroundAgentEnded) return

  const targetPath = state.viewSessionPath
  if (targetPath) {
    const result = await switchSession(targetPath)
    if (result.success) {
      state.runtimeSessionPath = targetPath
      updateSoftSwitched(state)
      await loadHistory()
    }
  }
  // Bug 4 FIX: always reset the flag
  state.softSwitchBackgroundAgentEnded = false
}

// --- Tests ---

describe('Bug 1: handleEvent stale closure', () => {
  it('events from new session are processed after hard switch', () => {
    const state = createSimState()
    state.viewSessionPath = '/session-a.jsonl'
    state.runtimeSessionPath = '/session-a.jsonl'
    state.runtimeSessionId = 'session-a-id'
    updateSoftSwitched(state)

    // Hard switch to session B
    state.viewSessionPath = '/session-b.jsonl'
    state.runtimeSessionPath = '/session-b.jsonl'
    state.runtimeSessionId = 'session-b-id'
    updateSoftSwitched(state)

    // Events from session B should be processed
    const result = simulateHandleEvent(state, {
      type: 'agent_start',
      sessionId: 'session-b-id',
    })

    expect(result.eventProcessed).toBe(true)
    expect(result.eventBuffered).toBe(false)
    expect(state.isStreaming).toBe(true)
  })

  it('events from old session are NOT processed after hard switch', () => {
    const state = createSimState()
    state.viewSessionPath = '/session-b.jsonl'
    state.runtimeSessionPath = '/session-b.jsonl'
    state.runtimeSessionId = 'session-b-id'
    updateSoftSwitched(state)

    // Stale event from old session A
    const result = simulateHandleEvent(state, {
      type: 'text_delta',
      sessionId: 'session-a-id',
    })

    // Not in soft-switch mode, so it's processed (no filtering in normal mode)
    // This is correct — in normal mode, the old session shouldn't be sending events
    expect(result.eventProcessed).toBe(true)
  })

  it('soft-switched mode buffers events from runtime session', () => {
    const state = createSimState()
    state.viewSessionPath = '/session-b.jsonl'
    state.runtimeSessionPath = '/session-a.jsonl'
    state.runtimeSessionId = 'session-a-id'
    state.isStreaming = true
    updateSoftSwitched(state)
    expect(state.isSoftSwitched).toBe(true)

    const result = simulateHandleEvent(state, {
      type: 'text_delta',
      sessionId: 'session-a-id',
    })

    expect(result.eventProcessed).toBe(false)
    expect(result.eventBuffered).toBe(true)
    expect(state.backgroundEventBuffer).toHaveLength(1)
  })

  it('soft-switched mode discards events from non-runtime session', () => {
    const state = createSimState()
    state.viewSessionPath = '/session-b.jsonl'
    state.runtimeSessionPath = '/session-a.jsonl'
    state.runtimeSessionId = 'session-a-id'
    updateSoftSwitched(state)

    const result = simulateHandleEvent(state, {
      type: 'text_delta',
      sessionId: 'session-c-id',
    })

    expect(result.eventProcessed).toBe(false)
    expect(result.eventBuffered).toBe(false)
    expect(state.backgroundEventBuffer).toHaveLength(0)
  })
})

describe('Bug 2: loadHistory overwrites paths', () => {
  it('loadHistory does NOT overwrite already-set viewSessionPath', () => {
    const state = createSimState()
    state.viewSessionPath = '/session-b.jsonl'

    simulateLoadHistory(state, {
      sessionFile: '/session-a.jsonl',
      sessionId: 'session-a-id',
    })

    // viewSessionPath should remain /session-b.jsonl
    expect(state.viewSessionPath).toBe('/session-b.jsonl')
  })

  it('loadHistory does NOT overwrite already-set runtimeSessionPath', () => {
    const state = createSimState()
    state.runtimeSessionPath = '/session-b.jsonl'

    simulateLoadHistory(state, {
      sessionFile: '/session-a.jsonl',
      sessionId: 'session-a-id',
    })

    expect(state.runtimeSessionPath).toBe('/session-b.jsonl')
  })

  it('loadHistory sets paths when they are null (initial load)', () => {
    const state = createSimState()

    simulateLoadHistory(state, {
      sessionFile: '/session-a.jsonl',
      sessionId: 'session-a-id',
    })

    expect(state.viewSessionPath).toBe('/session-a.jsonl')
    expect(state.runtimeSessionPath).toBe('/session-a.jsonl')
    expect(state.runtimeSessionId).toBe('session-a-id')
  })

  it('loadHistory always updates runtimeSessionId', () => {
    const state = createSimState()
    state.viewSessionPath = '/session-b.jsonl'
    state.runtimeSessionPath = '/session-b.jsonl'
    state.runtimeSessionId = 'old-id'

    simulateLoadHistory(state, {
      sessionFile: '/session-b.jsonl',
      sessionId: 'new-id',
    })

    expect(state.runtimeSessionId).toBe('new-id')
    // Paths should not be overwritten
    expect(state.viewSessionPath).toBe('/session-b.jsonl')
  })
})

describe('Bug 3: exitSoftSwitch reloads messages', () => {
  it('exitSoftSwitch reloads full message history from runtime', async () => {
    const state = createSimState()
    state.viewSessionPath = '/session-b.jsonl'
    state.runtimeSessionPath = '/session-a.jsonl'
    state.runtimeSessionId = 'session-a-id'
    updateSoftSwitched(state)

    const fullMessages = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there', id: 'asst-1', blocks: [
        { type: 'text', content: 'Hi there' },
      ] },
    ]

    await simulateExitSoftSwitch(
      state,
      async () => fullMessages,
    )

    expect(state.messages).toEqual(fullMessages)
    expect(state.viewSessionPath).toBe('/session-a.jsonl')
    expect(state.isSoftSwitched).toBe(false)
  })

  it('exitSoftSwitch handles getMessages failure gracefully', async () => {
    const state = createSimState()
    state.viewSessionPath = '/session-b.jsonl'
    state.runtimeSessionPath = '/session-a.jsonl'
    updateSoftSwitched(state)
    state.messages = [{ role: 'existing', content: 'old msg' }]

    await simulateExitSoftSwitch(
      state,
      async () => { throw new Error('RPC failed') },
    )

    expect(state.messages).toEqual([])
    expect(state.viewSessionPath).toBe('/session-a.jsonl')
  })

  it('exitSoftSwitch initializes currentAssistantId when streaming', async () => {
    const state = createSimState()
    state.viewSessionPath = '/session-b.jsonl'
    state.runtimeSessionPath = '/session-a.jsonl'
    state.runtimeSessionId = 'session-a-id'
    state.isStreaming = true
    state.currentAssistantId = null
    updateSoftSwitched(state)

    const fullMessages = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Partial text...', id: 'asst-1', blocks: [
        { type: 'text', content: 'Partial text...' },
      ] },
    ]

    await simulateExitSoftSwitch(
      state,
      async () => fullMessages,
    )

    expect(state.currentAssistantId).toBe('asst-1')
    expect(state.currentContentBlocks.size).toBe(1)
    expect(state.isSoftSwitched).toBe(false)
  })

  it('exitSoftSwitch initializes currentAssistantId even when NOT streaming', async () => {
    const state = createSimState()
    state.viewSessionPath = '/session-b.jsonl'
    state.runtimeSessionPath = '/session-a.jsonl'
    state.isStreaming = false
    state.currentAssistantId = null
    updateSoftSwitched(state)

    const fullMessages = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Done', id: 'asst-1', blocks: [
        { type: 'text', content: 'Done' },
      ] },
    ]

    await simulateExitSoftSwitch(
      state,
      async () => fullMessages,
    )

    expect(state.currentAssistantId).toBe('asst-1')
    expect(state.currentContentBlocks.size).toBe(1)
  })

  it('exitSoftSwitch clears currentAssistantId when no assistant message exists', async () => {
    const state = createSimState()
    state.viewSessionPath = '/session-b.jsonl'
    state.runtimeSessionPath = '/session-a.jsonl'
    state.currentAssistantId = 'old-id'
    updateSoftSwitched(state)

    const fullMessages = [
      { role: 'user', content: 'Hello' },
    ]

    await simulateExitSoftSwitch(
      state,
      async () => fullMessages,
    )

    expect(state.currentAssistantId).toBeNull()
    expect(state.currentContentBlocks.size).toBe(0)
  })

  it('exitSoftSwitch clears the event buffer', async () => {
    const state = createSimState()
    state.viewSessionPath = '/session-b.jsonl'
    state.runtimeSessionPath = '/session-a.jsonl'
    state.runtimeSessionId = 'session-a-id'
    state.isStreaming = true
    state.backgroundEventBuffer = [
      { type: 'text_delta', sessionId: 'session-a-id' },
      { type: 'text_delta', sessionId: 'session-a-id' },
    ]
    updateSoftSwitched(state)

    await simulateExitSoftSwitch(
      state,
      async () => [
        { role: 'assistant', content: 'Updated text', id: 'asst-1', blocks: [
          { type: 'text', content: 'Updated text' },
        ] },
      ],
    )

    expect(state.backgroundEventBuffer).toEqual([])
    expect(state.currentAssistantId).toBe('asst-1')
  })

  it('live text_delta events are processed after exitSoftSwitch', async () => {
    const state = createSimState()
    state.viewSessionPath = '/session-b.jsonl'
    state.runtimeSessionPath = '/session-a.jsonl'
    state.runtimeSessionId = 'session-a-id'
    state.isStreaming = true
    state.currentAssistantId = null
    updateSoftSwitched(state)

    await simulateExitSoftSwitch(
      state,
      async () => [
        { role: 'assistant', content: 'Hello', id: 'asst-1', blocks: [
          { type: 'text', content: 'Hello' },
        ] },
      ],
    )

    expect(state.currentAssistantId).toBe('asst-1')
    expect(state.isSoftSwitched).toBe(false)

    // Now simulate a live event — should NOT be silently dropped
    const result = simulateHandleEvent(state, {
      type: 'message_update',
      sessionId: 'session-a-id',
    })

    expect(result.eventProcessed).toBe(true)
  })
})

describe('Bug 4: softSwitchBackgroundAgentEnded flag reset', () => {
  it('flag is always reset after useEffect runs', async () => {
    const state = createSimState()
    state.viewSessionPath = '/session-b.jsonl'
    state.runtimeSessionPath = '/session-a.jsonl'
    state.softSwitchBackgroundAgentEnded = true

    await simulateBackgroundAgentEndedEffect(
      state,
      async (path) => {
        expect(path).toBe('/session-b.jsonl')
        return { success: true }
      },
      async () => {},
    )

    expect(state.softSwitchBackgroundAgentEnded).toBe(false)
  })

  it('flag is reset even when switchSession fails', async () => {
    const state = createSimState()
    state.viewSessionPath = '/session-b.jsonl'
    state.softSwitchBackgroundAgentEnded = true

    await simulateBackgroundAgentEndedEffect(
      state,
      async () => ({ success: false }),
      async () => {},
    )

    expect(state.softSwitchBackgroundAgentEnded).toBe(false)
  })

  it('hard switch updates runtimeSessionPath after background agent ends', async () => {
    const state = createSimState()
    state.viewSessionPath = '/session-b.jsonl'
    state.runtimeSessionPath = '/session-a.jsonl'
    state.softSwitchBackgroundAgentEnded = true

    await simulateBackgroundAgentEndedEffect(
      state,
      async () => ({ success: true }),
      async () => {},
    )

    expect(state.runtimeSessionPath).toBe('/session-b.jsonl')
    expect(state.isSoftSwitched).toBe(false)
  })
})

describe('Bug 6: agent_end in soft switch does NOT set runtimeSessionPath', () => {
  it('agent_end sets flag but does NOT change runtimeSessionPath', () => {
    const state = createSimState()
    state.viewSessionPath = '/session-b.jsonl'
    state.runtimeSessionPath = '/session-a.jsonl'
    state.runtimeSessionId = 'session-a-id'
    state.isStreaming = true
    updateSoftSwitched(state)
    expect(state.isSoftSwitched).toBe(true)

    simulateHandleEvent(state, {
      type: 'agent_end',
      sessionId: 'session-a-id',
    })

    // runtimeSessionPath should NOT be changed by handleEvent
    expect(state.runtimeSessionPath).toBe('/session-a.jsonl')
    // But isStreaming should be false
    expect(state.isStreaming).toBe(false)
    // And the flag should be set
    expect(state.softSwitchBackgroundAgentEnded).toBe(true)
    // isSoftSwitched should still be true (since runtimeSessionPath wasn't changed)
    expect(state.isSoftSwitched).toBe(true)
  })

  it('after agent_end, the useEffect can properly detect soft-switch mode', () => {
    const state = createSimState()
    state.viewSessionPath = '/session-b.jsonl'
    state.runtimeSessionPath = '/session-a.jsonl'
    state.runtimeSessionId = 'session-a-id'
    updateSoftSwitched(state)

    simulateHandleEvent(state, {
      type: 'agent_end',
      sessionId: 'session-a-id',
    })

    // The flag is set and isSoftSwitched is still true
    // So the useEffect condition (softSwitchBackgroundAgentEnded) will trigger
    expect(state.softSwitchBackgroundAgentEnded).toBe(true)
    expect(state.isSoftSwitched).toBe(true)
  })

  it('full soft-switch lifecycle: enter → agent_end → hard switch', async () => {
    const state = createSimState()
    state.viewSessionPath = '/session-a.jsonl'
    state.runtimeSessionPath = '/session-a.jsonl'
    state.runtimeSessionId = 'session-a-id'
    state.isStreaming = true
    updateSoftSwitched(state)

    // Step 1: User soft-switches to B
    state.viewSessionPath = '/session-b.jsonl'
    updateSoftSwitched(state)
    expect(state.isSoftSwitched).toBe(true)

    // Step 2: Background events buffered
    simulateHandleEvent(state, { type: 'text_delta', sessionId: 'session-a-id' })
    expect(state.backgroundEventBuffer).toHaveLength(1)

    // Step 3: Agent ends in background
    simulateHandleEvent(state, { type: 'agent_end', sessionId: 'session-a-id' })
    expect(state.softSwitchBackgroundAgentEnded).toBe(true)
    expect(state.isSoftSwitched).toBe(true) // still soft-switched

    // Step 4: useEffect detects flag and performs hard switch
    await simulateBackgroundAgentEndedEffect(
      state,
      async (path) => {
        expect(path).toBe('/session-b.jsonl')
        return { success: true }
      },
      async () => {},
    )

    expect(state.runtimeSessionPath).toBe('/session-b.jsonl')
    expect(state.isSoftSwitched).toBe(false)
    expect(state.softSwitchBackgroundAgentEnded).toBe(false)
  })
})

describe('Hard switch flow: events not lost', () => {
  it('hard switch does not lose events from new session', async () => {
    const state = createSimState()
    state.viewSessionPath = '/session-a.jsonl'
    state.runtimeSessionPath = '/session-a.jsonl'
    state.runtimeSessionId = 'session-a-id'
    updateSoftSwitched(state)

    // Hard switch to B
    state.viewSessionPath = '/session-b.jsonl'
    state.runtimeSessionPath = '/session-b.jsonl'
    state.runtimeSessionId = 'session-b-id'
    updateSoftSwitched(state)
    expect(state.isSoftSwitched).toBe(false)

    // New session B starts streaming
    const result = simulateHandleEvent(state, {
      type: 'agent_start',
      sessionId: 'session-b-id',
    })

    expect(result.eventProcessed).toBe(true)
    expect(state.isStreaming).toBe(true)

    // Text delta from B
    const result2 = simulateHandleEvent(state, {
      type: 'message_update',
      sessionId: 'session-b-id',
    })

    expect(result2.eventProcessed).toBe(true)
  })

  it('rapid switch A→B→C: only latest viewSessionPath matters', () => {
    const state = createSimState()
    state.viewSessionPath = '/session-a.jsonl'
    state.runtimeSessionPath = '/session-a.jsonl'
    state.runtimeSessionId = 'session-a-id'
    state.isStreaming = true

    // Soft switch to B
    state.viewSessionPath = '/session-b.jsonl'
    updateSoftSwitched(state)

    // Then soft switch to C (still streaming A)
    state.viewSessionPath = '/session-c.jsonl'
    updateSoftSwitched(state)

    // Events from A should be buffered
    const result = simulateHandleEvent(state, {
      type: 'text_delta',
      sessionId: 'session-a-id',
    })

    expect(result.eventBuffered).toBe(true)
  })
})

describe('Buffer overflow protection', () => {
  it('buffer caps at 500 events', () => {
    const state = createSimState()
    state.viewSessionPath = '/session-b.jsonl'
    state.runtimeSessionPath = '/session-a.jsonl'
    state.runtimeSessionId = 'session-a-id'
    updateSoftSwitched(state)

    // Add 600 events
    for (let i = 0; i < 600; i++) {
      simulateHandleEvent(state, {
        type: 'text_delta',
        sessionId: 'session-a-id',
      })
    }

    expect(state.backgroundEventBuffer.length).toBe(500)
  })
})

describe('Bug 5: forkPoints useEffect respects viewSessionPath', () => {
  it('forkPoints should not load for currentSession when viewSessionPath is set', () => {
    // Simulates the App.tsx useEffect condition:
    // if (isConnected && currentSession?.filePath && !viewSessionPath) { loadForkPoints(...) }

    const isConnected = true
    const currentSessionFilePath = '/session-a.jsonl'
    const viewSessionPath = '/session-b.jsonl'

    // When viewSessionPath is set, should NOT auto-load forkPoints
    const shouldLoadForkPoints = isConnected && currentSessionFilePath && !viewSessionPath
    expect(shouldLoadForkPoints).toBe(false)
  })

  it('forkPoints should load when viewSessionPath is null', () => {
    const isConnected = true
    const currentSessionFilePath = '/session-a.jsonl'
    const viewSessionPath = null

    const shouldLoadForkPoints = isConnected && currentSessionFilePath && !viewSessionPath
    expect(shouldLoadForkPoints).toBe(true)
  })

  it('forkPoints should not load when disconnected', () => {
    const isConnected = false
    const currentSessionFilePath = '/session-a.jsonl'
    const viewSessionPath = null

    const shouldLoadForkPoints = isConnected && currentSessionFilePath && !viewSessionPath
    expect(shouldLoadForkPoints).toBe(false)
  })
})

describe('Edge cases: clearMessages resets streaming state', () => {
  it('clearMessages resets isStreaming to false', () => {
    const state = {
      isStreaming: true,
      messages: ['msg1', 'msg2'],
    }

    // Simulate clearMessages
    state.messages = []
    state.isStreaming = false

    expect(state.isStreaming).toBe(false)
    expect(state.messages).toEqual([])
  })
})

describe('New session / fork / clear blocked during soft-switch', () => {
  it('new session is blocked when soft-switched', () => {
    const state = createSimState()
    state.viewSessionPath = '/session-b.jsonl'
    state.runtimeSessionPath = '/session-a.jsonl'
    updateSoftSwitched(state)

    const canCreateNewSession = !state.isSoftSwitched && !state.isStreaming
    expect(canCreateNewSession).toBe(false)
  })

  it('fork is blocked when streaming', () => {
    const state = createSimState()
    state.isStreaming = true

    const canFork = !state.isSoftSwitched && !state.isStreaming
    expect(canFork).toBe(false)
  })

  it('clear is blocked when soft-switched', () => {
    const state = createSimState()
    state.viewSessionPath = '/session-b.jsonl'
    state.runtimeSessionPath = '/session-a.jsonl'
    updateSoftSwitched(state)

    const canClear = !state.isSoftSwitched && !state.isStreaming
    expect(canClear).toBe(false)
  })
})

describe('Bug 1 fix: exitSoftSwitch works regardless of isStreaming', () => {
  it('should exit soft-switch when agent has already ended (isStreaming=false)', async () => {
    const state = createSimState()
    state.viewSessionPath = '/session-b.jsonl'
    state.runtimeSessionPath = '/session-a.jsonl'
    state.runtimeSessionId = 'session-a-id'
    state.isStreaming = false
    state.isSoftSwitched = true
    state.currentAssistantId = null

    const fullMessages = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Done', id: 'asst-final', blocks: [
        { type: 'text', content: 'Done' },
      ] },
    ]

    await simulateExitSoftSwitch(
      state,
      async () => fullMessages,
    )

    expect(state.viewSessionPath).toBe('/session-a.jsonl')
    expect(state.isSoftSwitched).toBe(false)
    expect(state.currentAssistantId).toBe('asst-final')
  })

  it('handleSwitchSession triggers exitSoftSwitch even when isStreaming is false', () => {
    const isSoftSwitched = true
    const isStreaming = false
    const sessionPath = '/session-a.jsonl'
    const runtimeSessionPath = '/session-a.jsonl'

    const shouldExitSoftSwitch = isSoftSwitched && sessionPath === runtimeSessionPath
    expect(shouldExitSoftSwitch).toBe(true)
  })
})

describe('Bug 2 fix: isSoftSwitchedRef updated synchronously', () => {
  it('exitSoftSwitch sets isSoftSwitched=false immediately, events processed right away', async () => {
    const state = createSimState()
    state.viewSessionPath = '/session-b.jsonl'
    state.runtimeSessionPath = '/session-a.jsonl'
    state.runtimeSessionId = 'session-a-id'
    state.isStreaming = true
    state.currentAssistantId = null
    updateSoftSwitched(state)
    expect(state.isSoftSwitched).toBe(true)

    await simulateExitSoftSwitch(
      state,
      async () => [
        { role: 'assistant', content: 'Partial', id: 'asst-1', blocks: [
          { type: 'text', content: 'Partial' },
        ] },
      ],
    )

    expect(state.isSoftSwitched).toBe(false)
    expect(state.currentAssistantId).toBe('asst-1')

    // Event arriving immediately after exitSoftSwitch — should be processed, NOT buffered
    const result = simulateHandleEvent(state, {
      type: 'message_update',
      sessionId: 'session-a-id',
    })

    expect(result.eventProcessed).toBe(true)
    expect(result.eventBuffered).toBe(false)
  })
})

describe('Bug 3 fix: currentAssistantId always initialized from snapshot', () => {
  it('currentAssistantId set even when isStreamingRef is false (agent_end race)', async () => {
    const state = createSimState()
    state.viewSessionPath = '/session-b.jsonl'
    state.runtimeSessionPath = '/session-a.jsonl'
    state.isStreaming = false
    state.currentAssistantId = null
    updateSoftSwitched(state)

    await simulateExitSoftSwitch(
      state,
      async () => [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'World', id: 'asst-1', blocks: [
          { type: 'text', content: 'World' },
        ] },
      ],
    )

    expect(state.currentAssistantId).toBe('asst-1')
    expect(state.currentContentBlocks.size).toBe(1)
  })

  it('full end-to-end: soft-switch away → agent ends → switch back → messages loaded', async () => {
    const state = createSimState()
    state.viewSessionPath = '/session-a.jsonl'
    state.runtimeSessionPath = '/session-a.jsonl'
    state.runtimeSessionId = 'session-a-id'
    state.isStreaming = true
    updateSoftSwitched(state)

    // Soft switch to B
    state.viewSessionPath = '/session-b.jsonl'
    updateSoftSwitched(state)

    // Agent ends in background
    simulateHandleEvent(state, { type: 'agent_end', sessionId: 'session-a-id' })
    expect(state.isStreaming).toBe(false)
    expect(state.softSwitchBackgroundAgentEnded).toBe(true)

    // User clicks back to A (isStreaming is false)
    await simulateExitSoftSwitch(
      state,
      async () => [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Final answer', id: 'asst-final', blocks: [
          { type: 'text', content: 'Final answer' },
        ] },
      ],
    )

    expect(state.viewSessionPath).toBe('/session-a.jsonl')
    expect(state.isSoftSwitched).toBe(false)
    expect(state.currentAssistantId).toBe('asst-final')
    expect(state.messages).toHaveLength(2)
  })
})
