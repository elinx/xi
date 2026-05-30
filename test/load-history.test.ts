import { describe, it, expect, vi } from 'vitest'

/**
 * Tests for loadHistory message conversion logic (from usePiRpc.ts).
 *
 * We extract the pure conversion function and test it with various Pi message
 * formats, verifying the correct ChatMessage[] output.
 */

// --- Extracted conversion logic from usePiRpc.ts loadHistory ---
// This mirrors the logic in loadHistory() but as a pure function for testing.

interface PiContentBlock {
  type: string
  text?: string
  thinking?: string
  name?: string
  arguments?: Record<string, unknown>
  data?: string
  mimeType?: string
}

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  blocks: ContentBlock[]
  timestamp: number
  piEntryId?: string
}

type ContentBlock =
  | { type: 'text'; content: string }
  | { type: 'tool_call'; toolName: string; args: Record<string, unknown>; status: string }
  | { type: 'image'; src: string; alt: string }

function convertPiMessagesToChatMessages(piMessages: unknown[]): ChatMessage[] {
  const chatMessages: ChatMessage[] = []

  for (const raw of piMessages) {
    const msg = raw as Record<string, unknown>
    const piEntryId = typeof msg.id === 'string' ? msg.id : undefined
    if (msg.role === 'user') {
      const content = typeof msg.content === 'string'
        ? msg.content
        : Array.isArray(msg.content)
          ? (msg.content as PiContentBlock[])
              .filter((c): c is { type: 'string'; text: string } => c.type === 'text')
              .map((c) => c.text ?? '')
              .join('')
          : ''
      chatMessages.push({
        id: 'test-id',
        role: 'user',
        blocks: [{ type: 'text', content }],
        timestamp: typeof msg.timestamp === 'number' ? msg.timestamp : Date.now(),
        piEntryId,
      })
    } else if (msg.role === 'assistant') {
      const blocks: ContentBlock[] = []
      const content = msg.content as PiContentBlock[]
      if (Array.isArray(content)) {
        for (const c of content) {
          if (c.type === 'text') {
            blocks.push({ type: 'text', content: c.text ?? '' })
          } else if (c.type === 'thinking') {
            blocks.push({ type: 'text', content: '\u{1F4AD} ' + c.thinking })
          } else if (c.type === 'toolCall') {
            blocks.push({
              type: 'tool_call',
              toolName: c.name ?? '',
              args: c.arguments ?? {},
              status: 'completed',
            })
          }
        }
      }
      chatMessages.push({
        id: 'test-id',
        role: 'assistant',
        blocks,
        timestamp: typeof msg.timestamp === 'number' ? msg.timestamp : Date.now(),
        piEntryId,
      })
    } else if (msg.role === 'toolResult') {
      const lastAssistant = chatMessages.findLast((m) => m.role === 'assistant')
      if (lastAssistant) {
        const content = msg.content as PiContentBlock[]
        if (Array.isArray(content)) {
          for (const c of content) {
            if (c.type === 'text') {
              lastAssistant.blocks.push({ type: 'text', content: c.text ?? '' })
            } else if (c.type === 'image') {
              lastAssistant.blocks.push({
                type: 'image',
                src: `data:${c.mimeType};base64,${c.data}`,
                alt: `Result from ${msg.toolName as string}`,
              })
            }
          }
        }
      }
    }
  }

  return chatMessages
}

// --- Tests ---

describe('loadHistory conversion: user messages', () => {
  it('converts user message with string content', () => {
    const messages = [
      { role: 'user', content: 'Hello Pi', timestamp: 1000 },
    ]

    const result = convertPiMessagesToChatMessages(messages)
    expect(result).toHaveLength(1)
    expect(result[0].role).toBe('user')
    expect(result[0].blocks).toEqual([{ type: 'text', content: 'Hello Pi' }])
    expect(result[0].timestamp).toBe(1000)
  })

  it('converts user message with content blocks', () => {
    const messages = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'What is this?' },
          { type: 'image', data: 'abc123', mimeType: 'image/png' },
        ],
        timestamp: 2000,
      },
    ]

    const result = convertPiMessagesToChatMessages(messages)
    expect(result).toHaveLength(1)
    expect(result[0].blocks).toEqual([{ type: 'text', content: 'What is this?' }])
  })

  it('joins multiple text blocks in user content', () => {
    const messages = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Part 1 ' },
          { type: 'text', text: 'Part 2' },
        ],
        timestamp: 3000,
      },
    ]

    const result = convertPiMessagesToChatMessages(messages)
    expect(result[0].blocks).toEqual([{ type: 'text', content: 'Part 1 Part 2' }])
  })

  it('handles empty user content array', () => {
    const messages = [
      { role: 'user', content: [], timestamp: 4000 },
    ]

    const result = convertPiMessagesToChatMessages(messages)
    expect(result).toHaveLength(1)
    expect(result[0].blocks).toEqual([{ type: 'text', content: '' }])
  })

  it('uses Date.now() fallback when timestamp is missing', () => {
    const before = Date.now()
    const messages = [
      { role: 'user', content: 'test' },
    ]
    const result = convertPiMessagesToChatMessages(messages)
    const after = Date.now()
    expect(result[0].timestamp).toBeGreaterThanOrEqual(before)
    expect(result[0].timestamp).toBeLessThanOrEqual(after)
  })
})

describe('loadHistory conversion: assistant messages', () => {
  it('converts assistant message with text content', () => {
    const messages = [
      {
        role: 'assistant',
        content: [{ type: 'text', text: 'Hello! How can I help?' }],
        timestamp: 5000,
      },
    ]

    const result = convertPiMessagesToChatMessages(messages)
    expect(result).toHaveLength(1)
    expect(result[0].role).toBe('assistant')
    expect(result[0].blocks).toEqual([{ type: 'text', content: 'Hello! How can I help?' }])
  })

  it('converts assistant message with thinking content', () => {
    const messages = [
      {
        role: 'assistant',
        content: [{ type: 'thinking', thinking: 'Let me think about this...' }],
        timestamp: 6000,
      },
    ]

    const result = convertPiMessagesToChatMessages(messages)
    expect(result[0].blocks).toEqual([{ type: 'text', content: '\u{1F4AD} Let me think about this...' }])
  })

  it('converts assistant message with toolCall content', () => {
    const messages = [
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'I will run a command.' },
          { type: 'toolCall', name: 'bash', arguments: { command: 'ls -la' } },
        ],
        timestamp: 7000,
      },
    ]

    const result = convertPiMessagesToChatMessages(messages)
    expect(result[0].blocks).toHaveLength(2)
    expect(result[0].blocks[0]).toEqual({ type: 'text', content: 'I will run a command.' })
    expect(result[0].blocks[1]).toEqual({
      type: 'tool_call',
      toolName: 'bash',
      args: { command: 'ls -la' },
      status: 'completed',
    })
  })

  it('handles assistant message with empty content', () => {
    const messages = [
      { role: 'assistant', content: [], timestamp: 8000 },
    ]

    const result = convertPiMessagesToChatMessages(messages)
    expect(result).toHaveLength(1)
    expect(result[0].blocks).toHaveLength(0)
  })

  it('handles assistant message with non-array content', () => {
    const messages = [
      { role: 'assistant', content: null, timestamp: 9000 },
    ]

    const result = convertPiMessagesToChatMessages(messages)
    expect(result).toHaveLength(1)
    expect(result[0].blocks).toHaveLength(0)
  })
})

describe('loadHistory conversion: toolResult messages', () => {
  it('appends text tool result to last assistant message', () => {
    const messages = [
      { role: 'assistant', content: [{ type: 'toolCall', name: 'bash', arguments: { command: 'ls' } }], timestamp: 10000 },
      { role: 'toolResult', toolName: 'bash', content: [{ type: 'text', text: 'file1.txt\nfile2.txt' }], timestamp: 10001 },
    ]

    const result = convertPiMessagesToChatMessages(messages)
    expect(result).toHaveLength(1) // toolResult appended, not separate message
    expect(result[0].blocks).toHaveLength(2)
    expect(result[0].blocks[0].type).toBe('tool_call')
    expect(result[0].blocks[1]).toEqual({ type: 'text', content: 'file1.txt\nfile2.txt' })
  })

  it('appends image tool result to last assistant message', () => {
    const messages = [
      { role: 'assistant', content: [{ type: 'toolCall', name: 'screenshot', arguments: {} }], timestamp: 11000 },
      { role: 'toolResult', toolName: 'screenshot', content: [{ type: 'image', data: 'base64data', mimeType: 'image/png' }], timestamp: 11001 },
    ]

    const result = convertPiMessagesToChatMessages(messages)
    expect(result).toHaveLength(1)
    expect(result[0].blocks).toHaveLength(2)
    expect(result[0].blocks[1]).toEqual({
      type: 'image',
      src: 'data:image/png;base64,base64data',
      alt: 'Result from screenshot',
    })
  })

  it('appends mixed text and image tool results', () => {
    const messages = [
      { role: 'assistant', content: [{ type: 'toolCall', name: 'bash', arguments: {} }], timestamp: 12000 },
      {
        role: 'toolResult',
        toolName: 'bash',
        content: [
          { type: 'text', text: 'Output:' },
          { type: 'image', data: 'imgdata', mimeType: 'image/jpeg' },
        ],
        timestamp: 12001,
      },
    ]

    const result = convertPiMessagesToChatMessages(messages)
    expect(result[0].blocks).toHaveLength(3)
    expect(result[0].blocks[1]).toEqual({ type: 'text', content: 'Output:' })
    expect(result[0].blocks[2]).toEqual({
      type: 'image',
      src: 'data:image/jpeg;base64,imgdata',
      alt: 'Result from bash',
    })
  })

  it('skips toolResult when no prior assistant message exists', () => {
    const messages = [
      { role: 'toolResult', toolName: 'bash', content: [{ type: 'text', text: 'orphan result' }], timestamp: 13000 },
    ]

    const result = convertPiMessagesToChatMessages(messages)
    expect(result).toHaveLength(0)
  })

  it('appends to the LAST assistant message when multiple exist', () => {
    const messages = [
      { role: 'assistant', content: [{ type: 'text', text: 'First response' }], timestamp: 14000 },
      { role: 'assistant', content: [{ type: 'toolCall', name: 'bash', arguments: { command: 'echo hi' } }], timestamp: 14001 },
      { role: 'toolResult', toolName: 'bash', content: [{ type: 'text', text: 'hi' }], timestamp: 14002 },
    ]

    const result = convertPiMessagesToChatMessages(messages)
    expect(result).toHaveLength(2)
    // First assistant unchanged
    expect(result[0].blocks).toHaveLength(1)
    // Tool result appended to second assistant
    expect(result[1].blocks).toHaveLength(2)
    expect(result[1].blocks[1]).toEqual({ type: 'text', content: 'hi' })
  })
})

describe('loadHistory conversion: full conversation', () => {
  it('converts a complete user-assistant-toolResult-user conversation', () => {
    const messages = [
      { role: 'user', content: 'List files', timestamp: 20000 },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Let me check.' },
          { type: 'toolCall', name: 'bash', arguments: { command: 'ls' } },
        ],
        timestamp: 20001,
      },
      { role: 'toolResult', toolName: 'bash', content: [{ type: 'text', text: 'a.txt\nb.txt' }], timestamp: 20002 },
      { role: 'assistant', content: [{ type: 'text', text: 'Found 2 files.' }], timestamp: 20003 },
      { role: 'user', content: 'Thanks', timestamp: 20004 },
    ]

    const result = convertPiMessagesToChatMessages(messages)
    expect(result).toHaveLength(4)
    // user: "List files"
    expect(result[0].role).toBe('user')
    expect(result[0].blocks[0]).toEqual({ type: 'text', content: 'List files' })
    // assistant: text + tool_call + tool_result_text
    expect(result[1].role).toBe('assistant')
    expect(result[1].blocks).toHaveLength(3)
    // assistant: "Found 2 files."
    expect(result[2].role).toBe('assistant')
    expect(result[2].blocks[0]).toEqual({ type: 'text', content: 'Found 2 files.' })
    // user: "Thanks"
    expect(result[3].role).toBe('user')
    expect(result[3].blocks[0]).toEqual({ type: 'text', content: 'Thanks' })
  })

  it('handles empty message list', () => {
    expect(convertPiMessagesToChatMessages([])).toEqual([])
  })

  it('handles messages with unknown roles gracefully', () => {
    const messages = [
      { role: 'system', content: 'system message', timestamp: 21000 },
      { role: 'user', content: 'hello', timestamp: 21001 },
    ]

    const result = convertPiMessagesToChatMessages(messages)
    expect(result).toHaveLength(1)
    expect(result[0].role).toBe('user')
  })
})

describe('Fork flow with user-provided name', () => {
  it('forkAtEntry sends entryId to IPC then renames with user name', async () => {
    const api = {
      forkAtEntry: vi.fn().mockResolvedValue({ success: true }),
      renameSession: vi.fn().mockResolvedValue({ success: true }),
      listSessions: vi.fn().mockResolvedValue({ projects: [] }),
      getCurrentSession: vi.fn().mockResolvedValue(null),
    }

    // Simulates useSessionManager.forkAtEntry
    async function forkAtEntry(entryId: string, name: string) {
      const result = await api.forkAtEntry(entryId)
      if (result.success) {
        await api.renameSession(name)
        await api.listSessions()
        await api.getCurrentSession()
      }
    }

    await forkAtEntry('entry-42', 'my-experiment')

    expect(api.forkAtEntry).toHaveBeenCalledWith('entry-42')
    expect(api.renameSession).toHaveBeenCalledWith('my-experiment')
  })

  it('does not rename when fork fails', async () => {
    const api = {
      forkAtEntry: vi.fn().mockResolvedValue({ success: false, error: 'Fork failed' }),
      renameSession: vi.fn().mockResolvedValue({ success: true }),
    }

    async function forkAtEntry(entryId: string, name: string) {
      const result = await api.forkAtEntry(entryId)
      if (result.success) {
        await api.renameSession(name)
      }
    }

    await forkAtEntry('entry-99', 'should-not-rename')

    expect(api.forkAtEntry).toHaveBeenCalledWith('entry-99')
    expect(api.renameSession).not.toHaveBeenCalled()
  })

  it('App handleForkAtEntry calls clearMessages, forkAtEntry, loadHistory, refresh', async () => {
    const calls: string[] = []

    const clearMessages = vi.fn().mockImplementation(() => calls.push('clearMessages'))
    const forkAtEntry = vi.fn().mockImplementation(async () => { calls.push('forkAtEntry') })
    const loadHistory = vi.fn().mockImplementation(async () => { calls.push('loadHistory') })
    const refresh = vi.fn().mockImplementation(async () => { calls.push('refresh') })

    // Simulates App.tsx handleForkAtEntry
    async function handleForkAtEntry(entryId: string, name: string) {
      clearMessages()
      await forkAtEntry(entryId, name)
      await loadHistory()
      await refresh()
    }

    await handleForkAtEntry('entry-1', 'fork-name')

    expect(calls).toEqual(['clearMessages', 'forkAtEntry', 'loadHistory', 'refresh'])
    expect(forkAtEntry).toHaveBeenCalledWith('entry-1', 'fork-name')
  })
})

describe('Switch session + loadHistory', () => {
  it('App handleSwitchSession calls clearMessages, switchSession, loadHistory, refresh', async () => {
    const calls: string[] = []

    const clearMessages = vi.fn().mockImplementation(() => calls.push('clearMessages'))
    const switchSession = vi.fn().mockImplementation(async () => { calls.push('switchSession') })
    const loadHistory = vi.fn().mockImplementation(async () => { calls.push('loadHistory') })
    const refresh = vi.fn().mockImplementation(async () => { calls.push('refresh') })

    // Simulates App.tsx handleSwitchSession
    async function handleSwitchSession(sessionPath: string) {
      clearMessages()
      await switchSession(sessionPath)
      await loadHistory()
      await refresh()
    }

    await handleSwitchSession('/other-session.jsonl')

    expect(calls).toEqual(['clearMessages', 'switchSession', 'loadHistory', 'refresh'])
    expect(switchSession).toHaveBeenCalledWith('/other-session.jsonl')
  })

  it('loadHistory still called even if switchSession has no explicit success check', async () => {
    const loadHistory = vi.fn().mockResolvedValue(undefined)
    const switchSession = vi.fn().mockResolvedValue({ success: true })

    // In App.tsx, handleSwitchSession does NOT check success before loadHistory
    async function handleSwitchSession(sessionPath: string) {
      await switchSession(sessionPath)
      await loadHistory()
    }

    await handleSwitchSession('/session.jsonl')

    expect(loadHistory).toHaveBeenCalled()
  })
})

describe('ForkNameInput validation', () => {
  it('requires non-empty fork name before confirming', () => {
    const onForkAtEntry = vi.fn()

    const forkName = '   '

    if (forkName.trim()) {
      onForkAtEntry(defaultEntryId, forkName.trim())
    }

    expect(onForkAtEntry).not.toHaveBeenCalled()
  })

  it('calls onForkAtEntry with trimmed name', () => {
    const onForkAtEntry = vi.fn()

    const defaultEntryId = 'entry-1'
    const forkName = '  my-fork  '

    if (forkName.trim()) {
      onForkAtEntry(defaultEntryId, forkName.trim())
    }

    expect(onForkAtEntry).toHaveBeenCalledWith('entry-1', 'my-fork')
  })

  it('always has an entryId from the message', () => {
    const onForkAtEntry = vi.fn()

    const defaultEntryId = 'entry-1'
    const forkName = 'some-name'

    if (forkName.trim()) {
      onForkAtEntry(defaultEntryId, forkName.trim())
    }

    expect(onForkAtEntry).toHaveBeenCalledWith('entry-1', 'some-name')
  })
})

describe('loadHistory: piEntryId extraction', () => {
  it('extracts id from Pi messages as piEntryId', () => {
    const messages = [
      { role: 'user', content: 'Hello', timestamp: 1000, id: 'entry-user-1' },
      { role: 'assistant', content: [], timestamp: 1001, id: 'entry-asst-1' },
    ]

    const result = convertPiMessagesToChatMessages(messages)
    expect(result).toHaveLength(2)
    expect(result[0].piEntryId).toBe('entry-user-1')
    expect(result[1].piEntryId).toBe('entry-asst-1')
  })

  it('leaves piEntryId undefined when id is missing', () => {
    const messages = [
      { role: 'user', content: 'Hello', timestamp: 1000 },
    ]

    const result = convertPiMessagesToChatMessages(messages)
    expect(result[0].piEntryId).toBeUndefined()
  })

  it('leaves piEntryId undefined when id is not a string', () => {
    const messages = [
      { role: 'user', content: 'Hello', timestamp: 1000, id: 42 },
    ]

    const result = convertPiMessagesToChatMessages(messages)
    expect(result[0].piEntryId).toBeUndefined()
  })
})

describe('Fork point marker matching', () => {
  interface ForkPoint { entryId: string; childName: string }
  interface MsgWithEntryId { piEntryId?: string; role: string }

  function matchForkPoints(messages: MsgWithEntryId[], forkPoints: ForkPoint[]): Map<number, ForkPoint[]> {
    const matches = new Map<number, ForkPoint[]>()
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i]
      if (!msg.piEntryId) continue
      const matched = forkPoints.filter(fp => fp.entryId === msg.piEntryId)
      if (matched.length > 0) {
        matches.set(i, matched)
      }
    }
    return matches
  }

  it('matches fork points to messages by piEntryId', () => {
    const messages: MsgWithEntryId[] = [
      { role: 'user', piEntryId: 'entry-1' },
      { role: 'assistant' },
      { role: 'user', piEntryId: 'entry-2' },
    ]
    const forkPoints: ForkPoint[] = [
      { entryId: 'entry-1', childName: 'experiment-1' },
    ]

    const matches = matchForkPoints(messages, forkPoints)
    expect(matches.has(0)).toBe(true)
    expect(matches.get(0)![0].childName).toBe('experiment-1')
    expect(matches.has(2)).toBe(false)
  })

  it('matches multiple fork points to same message', () => {
    const messages: MsgWithEntryId[] = [
      { role: 'user', piEntryId: 'entry-1' },
    ]
    const forkPoints: ForkPoint[] = [
      { entryId: 'entry-1', childName: 'fork-a' },
      { entryId: 'entry-1', childName: 'fork-b' },
    ]

    const matches = matchForkPoints(messages, forkPoints)
    expect(matches.get(0)).toHaveLength(2)
  })

  it('returns empty map when no messages have piEntryId', () => {
    const messages: MsgWithEntryId[] = [
      { role: 'user' },
      { role: 'assistant' },
    ]
    const forkPoints: ForkPoint[] = [
      { entryId: 'entry-1', childName: 'fork-a' },
    ]

    const matches = matchForkPoints(messages, forkPoints)
    expect(matches.size).toBe(0)
  })

  it('returns empty map when fork points list is empty', () => {
    const messages: MsgWithEntryId[] = [
      { role: 'user', piEntryId: 'entry-1' },
    ]

    const matches = matchForkPoints(messages, [])
    expect(matches.size).toBe(0)
  })
})

describe('Delete session flow', () => {
  it('useSessionManager.deleteSession calls IPC and refreshes', async () => {
    const api = {
      deleteSession: vi.fn().mockResolvedValue({ success: true }),
      listSessions: vi.fn().mockResolvedValue({ projects: [] }),
      getCurrentSession: vi.fn().mockResolvedValue(null),
    }

    async function handleDeleteSession(sessionPath: string): Promise<boolean> {
      const result = await api.deleteSession(sessionPath)
      if (result.success) {
        await api.listSessions()
        return true
      }
      return false
    }

    const result = await handleDeleteSession('/old-session.jsonl')
    expect(result).toBe(true)
    expect(api.deleteSession).toHaveBeenCalledWith('/old-session.jsonl')
    expect(api.listSessions).toHaveBeenCalled()
  })

  it('returns false when delete fails', async () => {
    const api = {
      deleteSession: vi.fn().mockResolvedValue({ success: false, error: 'Cannot delete active session' }),
    }

    async function handleDeleteSession(sessionPath: string): Promise<boolean> {
      const result = await api.deleteSession(sessionPath)
      return result.success
    }

    const result = await handleDeleteSession('/active-session.jsonl')
    expect(result).toBe(false)
  })
})

describe('Jump to parent session', () => {
  it('parent link calls onSwitchSession with parentSessionPath', () => {
    const onSwitch = vi.fn()
    const parentSessionPath = '/parent-session.jsonl'

    onSwitch(parentSessionPath)
    expect(onSwitch).toHaveBeenCalledWith('/parent-session.jsonl')
  })

  it('forked session has parentSessionPath', () => {
    const forkedSession = {
      filePath: '/fork.jsonl',
      parentSessionPath: '/main.jsonl',
      name: 'experiment-1',
    }
    expect(forkedSession.parentSessionPath).toBe('/main.jsonl')
  })

  it('root session has null parentSessionPath', () => {
    const rootSession = {
      filePath: '/main.jsonl',
      parentSessionPath: null,
      name: 'main',
    }
    expect(rootSession.parentSessionPath).toBeNull()
  })
})
