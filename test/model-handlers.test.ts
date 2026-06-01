import { describe, it, expect, vi } from 'vitest'

describe('Model: get_available_models', () => {
  it('returns models list with auth status', async () => {
    const sendRpcCommand = vi.fn().mockResolvedValue({
      models: [
        { provider: 'anthropic', id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5', hasAuth: true, reasoning: true, contextWindow: 200000 },
        { provider: 'openai', id: 'gpt-4o', name: 'GPT-4o', hasAuth: false, reasoning: false, contextWindow: 128000 },
      ],
    })

    async function handleGetAvailableModels() {
      const data = await sendRpcCommand({ type: 'get_available_models' })
      return { ok: true, data }
    }

    const result = await handleGetAvailableModels()
    expect(result.ok).toBe(true)
    expect(result.data.models).toHaveLength(2)
    expect(result.data.models[0].hasAuth).toBe(true)
    expect(result.data.models[1].hasAuth).toBe(false)
  })
})

describe('Model: set_model', () => {
  it('constructs correct RPC command with model ID', async () => {
    const sendRpcCommand = vi.fn().mockResolvedValue(undefined)

    async function handleSetModel(model: string) {
      await sendRpcCommand({ type: 'set_model', model })
      return { ok: true }
    }

    await handleSetModel('claude-sonnet-4-5')
    expect(sendRpcCommand).toHaveBeenCalledWith({
      type: 'set_model',
      model: 'claude-sonnet-4-5',
    })
  })

  it('constructs correct RPC command with model ID and provider', async () => {
    const sendRpcCommand = vi.fn().mockResolvedValue(undefined)

    async function handleSetModel(model: string, provider?: string) {
      const cmd: Record<string, unknown> = { type: 'set_model', model }
      if (provider) cmd.provider = provider
      await sendRpcCommand(cmd)
      return { ok: true }
    }

    await handleSetModel('claude-sonnet-4-5', 'anthropic')
    expect(sendRpcCommand).toHaveBeenCalledWith({
      type: 'set_model',
      model: 'claude-sonnet-4-5',
      provider: 'anthropic',
    })
  })
})

describe('Model: cycle_model', () => {
  it('constructs correct RPC command with direction', async () => {
    const sendRpcCommand = vi.fn().mockResolvedValue({ model: { provider: 'anthropic', id: 'claude-sonnet-4-5' } })

    async function handleCycleModel(direction?: 'next' | 'prev') {
      const cmd: Record<string, unknown> = { type: 'cycle_model' }
      if (direction) cmd.direction = direction
      const data = await sendRpcCommand(cmd)
      return { ok: true, data }
    }

    const result = await handleCycleModel('next')
    expect(sendRpcCommand).toHaveBeenCalledWith({ type: 'cycle_model', direction: 'next' })
    expect(result.ok).toBe(true)
  })
})

describe('Model: get_state enhanced', () => {
  it('includes model info in response', () => {
    const mockSession = {
      sessionFile: '/test/session.jsonl',
      sessionId: 'test-id',
      sessionName: 'Test Session',
      isStreaming: false,
      isCompacting: false,
      thinkingLevel: 'medium',
      messages: { length: 5 },
      model: { provider: 'anthropic', id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5' },
    }

    function buildGetStateResponse(session: typeof mockSession) {
      return {
        sessionFile: session.sessionFile,
        sessionId: session.sessionId,
        sessionName: session.sessionName,
        isStreaming: session.isStreaming,
        isCompacting: session.isCompacting,
        thinkingLevel: session.thinkingLevel,
        messageCount: session.messages.length,
        model: session.model
          ? { provider: session.model.provider, id: session.model.id, name: session.model.name }
          : null,
      }
    }

    const result = buildGetStateResponse(mockSession)
    expect(result.model).toEqual({ provider: 'anthropic', id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5' })
    expect(result.thinkingLevel).toBe('medium')
  })

  it('returns null model when no model is set', () => {
    const mockSession = {
      sessionFile: '/test/session.jsonl',
      sessionId: 'test-id',
      sessionName: null,
      isStreaming: false,
      isCompacting: false,
      thinkingLevel: 'off',
      messages: { length: 0 },
      model: undefined,
    }

    function buildGetStateResponse(session: typeof mockSession) {
      return {
        sessionFile: session.sessionFile,
        sessionId: session.sessionId,
        sessionName: session.sessionName,
        isStreaming: session.isStreaming,
        isCompacting: session.isCompacting,
        thinkingLevel: session.thinkingLevel,
        messageCount: session.messages.length,
        model: session.model
          ? { provider: session.model.provider, id: session.model.id, name: session.model.name }
          : null,
      }
    }

    const result = buildGetStateResponse(mockSession)
    expect(result.model).toBeNull()
  })
})
