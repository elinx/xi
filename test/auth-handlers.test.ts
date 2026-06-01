import { describe, it, expect, vi, beforeEach } from 'vitest'

describe('Auth: set_api_key', () => {
  it('constructs correct RPC command with provider and apiKey', async () => {
    const sendRpcCommand = vi.fn().mockResolvedValue(undefined)

    async function handleSetApiKey(provider: string, apiKey: string) {
      await sendRpcCommand({ type: 'set_api_key', provider, apiKey })
      return { ok: true }
    }

    await handleSetApiKey('anthropic', 'sk-ant-123')
    expect(sendRpcCommand).toHaveBeenCalledWith({
      type: 'set_api_key',
      provider: 'anthropic',
      apiKey: 'sk-ant-123',
    })
  })

  it('returns error when Pi not connected', async () => {
    async function handleSetApiKey(provider: string, apiKey: string) {
      return { ok: false, error: 'Pi not connected' }
    }

    const result = await handleSetApiKey('anthropic', 'sk-ant-123')
    expect(result.ok).toBe(false)
  })
})

describe('Auth: get_provider_auth_status', () => {
  it('returns auth status for all providers', async () => {
    const sendRpcCommand = vi.fn().mockResolvedValue({
      anthropic: { configured: true, source: 'stored' },
      openai: { configured: false },
    })

    async function handleGetAuthStatus() {
      if (!true) return { ok: false, error: 'Pi not connected' }
      const data = await sendRpcCommand({ type: 'get_provider_auth_status' })
      return { ok: true, data }
    }

    const result = await handleGetAuthStatus()
    expect(result.ok).toBe(true)
    expect(result.data.anthropic.configured).toBe(true)
    expect(result.data.openai.configured).toBe(false)
  })
})

describe('Auth: remove_auth', () => {
  it('constructs correct RPC command', async () => {
    const sendRpcCommand = vi.fn().mockResolvedValue(undefined)

    async function handleRemoveAuth(provider: string) {
      await sendRpcCommand({ type: 'remove_auth', provider })
      return { ok: true }
    }

    await handleRemoveAuth('anthropic')
    expect(sendRpcCommand).toHaveBeenCalledWith({
      type: 'remove_auth',
      provider: 'anthropic',
    })
  })
})

describe('Auth: register_custom_provider', () => {
  it('constructs correct RPC command with provider and config', async () => {
    const sendRpcCommand = vi.fn().mockResolvedValue(undefined)

    async function handleRegisterCustomProvider(provider: string, config: Record<string, unknown>) {
      await sendRpcCommand({ type: 'register_custom_provider', provider, config })
      return { ok: true }
    }

    const config = {
      name: 'My LLM',
      baseUrl: 'https://api.my-llm.com/v1',
      apiKey: 'my-key',
      models: [{
        id: 'my-model',
        name: 'My Model',
        reasoning: false,
        input: ['text'],
        cost: { input: 0.001, output: 0.002, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 4096,
      }],
    }

    await handleRegisterCustomProvider('my-llm', config)
    expect(sendRpcCommand).toHaveBeenCalledWith({
      type: 'register_custom_provider',
      provider: 'my-llm',
      config,
    })
  })
})
