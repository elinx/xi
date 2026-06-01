import { useState, useEffect, useCallback } from 'react'

const PROVIDER_URLS: Record<string, string> = {
  anthropic: 'https://console.anthropic.com/settings/keys',
  openai: 'https://platform.openai.com/api-keys',
  google: 'https://aistudio.google.com/apikey',
  deepseek: 'https://platform.deepseek.com/api_keys',
  openrouter: 'https://openrouter.ai/settings/keys',
  groq: 'https://console.groq.com/keys',
  xai: 'https://console.x.ai/',
  mistral: 'https://console.mistral.ai/api-keys/',
}

const POPULAR_PROVIDERS = [
  { id: 'anthropic', name: 'Anthropic', subtitle: 'Claude', color: '#d97706' },
  { id: 'openai', name: 'OpenAI', subtitle: 'GPT', color: '#10a37f' },
  { id: 'google', name: 'Google', subtitle: 'Gemini', color: '#4285f4' },
  { id: 'deepseek', name: 'DeepSeek', subtitle: 'DeepSeek', color: '#4f46e5' },
  { id: 'openrouter', name: 'OpenRouter', subtitle: 'Multi-provider', color: '#6d28d9' },
  { id: 'groq', name: 'Groq', subtitle: 'Fast inference', color: '#f55036' },
  { id: 'xai', name: 'xAI', subtitle: 'Grok', color: '#1d1d1f' },
  { id: 'mistral', name: 'Mistral', subtitle: 'Mistral AI', color: '#f97316' },
]

type AuthStatusMap = Record<string, { configured: boolean; source?: string }>

interface ProviderSetupProps {
  getProviderAuthStatus: () => Promise<AuthStatusMap>
  setApiKey: (provider: string, apiKey: string) => Promise<boolean>
  removeAuth: (provider: string) => Promise<boolean>
  registerCustomProvider: (provider: string, config: Record<string, unknown>) => Promise<boolean>
  onAuthChange?: () => void
}

function ProviderSetup({ getProviderAuthStatus, setApiKey, removeAuth, registerCustomProvider, onAuthChange }: ProviderSetupProps): React.ReactElement {
  const [authStatus, setAuthStatus] = useState<AuthStatusMap>({})
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null)
  const [apiKey, setApiKeyInput] = useState('')
  const [showApiKey, setShowApiKey] = useState(false)
  const [saving, setSaving] = useState(false)
  const [showCustom, setShowCustom] = useState(false)
  const [removing, setRemoving] = useState<string | null>(null)

  const [customId, setCustomId] = useState('')
  const [customName, setCustomName] = useState('')
  const [customBaseUrl, setCustomBaseUrl] = useState('')
  const [customApiKey, setCustomApiKey] = useState('')
  const [customModelId, setCustomModelId] = useState('')
  const [customModelName, setCustomModelName] = useState('')
  const [customReasoning, setCustomReasoning] = useState(false)
  const [customContextWindow, setCustomContextWindow] = useState(128000)
  const [customSaving, setCustomSaving] = useState(false)

  const refreshAuth = useCallback(async () => {
    const status = await getProviderAuthStatus()
    setAuthStatus(status)
  }, [getProviderAuthStatus])

  useEffect(() => {
    refreshAuth()
  }, [refreshAuth])

  const handleSetApiKey = useCallback(async () => {
    if (!selectedProvider || !apiKey.trim()) return
    setSaving(true)
    const ok = await setApiKey(selectedProvider, apiKey.trim())
    setSaving(false)
    if (ok) {
      setApiKeyInput('')
      setSelectedProvider(null)
      await refreshAuth()
      onAuthChange?.()
    }
  }, [selectedProvider, apiKey, setApiKey, refreshAuth, onAuthChange])

  const handleRemoveAuth = useCallback(async (provider: string) => {
    setRemoving(provider)
    const ok = await removeAuth(provider)
    setRemoving(null)
    if (ok) {
      await refreshAuth()
      onAuthChange?.()
    }
  }, [removeAuth, refreshAuth, onAuthChange])

  const handleAddCustomProvider = useCallback(async () => {
    if (!customId.trim() || !customBaseUrl.trim() || !customModelId.trim()) return
    setCustomSaving(true)
    const config: Record<string, unknown> = {
      name: customName.trim() || customId.trim(),
      baseUrl: customBaseUrl.trim(),
      models: [{
        id: customModelId.trim(),
        name: customModelName.trim() || customModelId.trim(),
        reasoning: customReasoning,
        input: ['text' as const, 'image' as const],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: customContextWindow,
        maxTokens: customContextWindow,
      }],
    }
    if (customApiKey.trim()) {
      config.apiKey = customApiKey.trim()
    }
    const ok = await registerCustomProvider(customId.trim(), config)
    setCustomSaving(false)
    if (ok) {
      setCustomId('')
      setCustomName('')
      setCustomBaseUrl('')
      setCustomApiKey('')
      setCustomModelId('')
      setCustomModelName('')
      setCustomReasoning(false)
      setCustomContextWindow(128000)
      setShowCustom(false)
      await refreshAuth()
      onAuthChange?.()
    }
  }, [customId, customName, customBaseUrl, customApiKey, customModelId, customModelName, customReasoning, customContextWindow, registerCustomProvider, refreshAuth, onAuthChange])

  const configuredProviders = Object.entries(authStatus).filter(([, s]) => s.configured)

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">Providers</h3>
        <div className="grid grid-cols-2 gap-2">
          {POPULAR_PROVIDERS.map((p) => {
            const isConfigured = authStatus[p.id]?.configured
            return (
              <button
                key={p.id}
                onClick={() => {
                  if (!isConfigured) {
                    setSelectedProvider(selectedProvider === p.id ? null : p.id)
                    setApiKeyInput('')
                  }
                }}
                className={`flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-all ${
                  isConfigured
                    ? 'border-green-200 bg-green-50/60'
                    : selectedProvider === p.id
                      ? 'border-blue-300 bg-blue-50 shadow-sm'
                      : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50'
                }`}
              >
                <span
                  className="flex h-7 w-7 items-center justify-center rounded-md text-white text-xs font-bold flex-shrink-0"
                  style={{ backgroundColor: p.color }}
                >
                  {p.name[0]}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium text-gray-900 truncate">{p.name}</div>
                  <div className="text-[10px] text-gray-400">{p.subtitle}</div>
                </div>
                {isConfigured ? (
                  <svg className="w-4 h-4 text-green-500 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                ) : (
                  <span className="h-4 w-4 rounded-full border-2 border-gray-300 flex-shrink-0" />
                )}
              </button>
            )
          })}
        </div>
      </div>

      {selectedProvider && (
        <div className="rounded-lg border border-blue-200 bg-blue-50/40 p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h4 className="text-sm font-medium text-gray-900">
                {POPULAR_PROVIDERS.find(p => p.id === selectedProvider)?.name ?? selectedProvider}
              </h4>
              <p className="text-[11px] text-gray-500 mt-0.5">Enter your API key to enable this provider</p>
            </div>
            <button
              onClick={() => { setSelectedProvider(null); setApiKeyInput('') }}
              className="rounded p-1 text-gray-400 hover:text-gray-600 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <input
                type={showApiKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKeyInput(e.target.value)}
                placeholder="sk-..."
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 pr-9 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-400 focus:border-blue-400"
                onKeyDown={(e) => { if (e.key === 'Enter') handleSetApiKey() }}
              />
              <button
                onClick={() => setShowApiKey(!showApiKey)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                {showApiKey ? (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                )}
              </button>
            </div>
            <button
              onClick={handleSetApiKey}
              disabled={!apiKey.trim() || saving}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50 disabled:hover:bg-blue-600 transition-colors"
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
          {PROVIDER_URLS[selectedProvider] && (
            <a
              href={PROVIDER_URLS[selectedProvider]}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-flex items-center gap-1 text-[11px] text-blue-600 hover:text-blue-800 transition-colors"
            >
              Get API key from {POPULAR_PROVIDERS.find(p => p.id === selectedProvider)?.name}
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </a>
          )}
        </div>
      )}

      <div>
        <button
          onClick={() => setShowCustom(!showCustom)}
          className="flex items-center gap-2 text-xs font-medium text-gray-600 hover:text-gray-900 transition-colors"
        >
          <svg className={`w-3.5 h-3.5 transition-transform ${showCustom ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
          Add custom provider (OpenAI-compatible)
        </button>

        {showCustom && (
          <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50/60 p-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-medium text-gray-600 mb-1">Provider ID</label>
                <input
                  type="text"
                  value={customId}
                  onChange={(e) => setCustomId(e.target.value.replace(/[^a-z0-9-]/g, ''))}
                  placeholder="my-llm"
                  className="w-full rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-xs text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-gray-600 mb-1">Display name</label>
                <input
                  type="text"
                  value={customName}
                  onChange={(e) => setCustomName(e.target.value)}
                  placeholder="My LLM Server"
                  className="w-full rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-xs text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
                />
              </div>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-gray-600 mb-1">Base URL</label>
              <input
                type="text"
                value={customBaseUrl}
                onChange={(e) => setCustomBaseUrl(e.target.value)}
                placeholder="https://api.my-llm.com/v1"
                className="w-full rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-xs text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-gray-600 mb-1">API Key <span className="text-gray-400">(optional)</span></label>
              <input
                type="password"
                value={customApiKey}
                onChange={(e) => setCustomApiKey(e.target.value)}
                placeholder="sk-..."
                className="w-full rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-xs text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-medium text-gray-600 mb-1">Model ID</label>
                <input
                  type="text"
                  value={customModelId}
                  onChange={(e) => setCustomModelId(e.target.value)}
                  placeholder="my-model-v1"
                  className="w-full rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-xs text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-gray-600 mb-1">Model name</label>
                <input
                  type="text"
                  value={customModelName}
                  onChange={(e) => setCustomModelName(e.target.value)}
                  placeholder="My Model V1"
                  className="w-full rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-xs text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
                />
              </div>
            </div>
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-1.5 text-xs text-gray-600">
                <input
                  type="checkbox"
                  checked={customReasoning}
                  onChange={(e) => setCustomReasoning(e.target.checked)}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-400"
                />
                Reasoning support
              </label>
              <div className="flex items-center gap-1.5">
                <label className="text-xs text-gray-600">Context window:</label>
                <input
                  type="number"
                  value={customContextWindow}
                  onChange={(e) => setCustomContextWindow(Number(e.target.value) || 128000)}
                  className="w-24 rounded-md border border-gray-300 bg-white px-2 py-1 text-xs text-gray-900 focus:outline-none focus:ring-1 focus:ring-blue-400"
                />
              </div>
            </div>
            <button
              onClick={handleAddCustomProvider}
              disabled={!customId.trim() || !customBaseUrl.trim() || !customModelId.trim() || customSaving}
              className="rounded-md bg-gray-900 px-4 py-2 text-xs font-medium text-white hover:bg-gray-800 disabled:opacity-50 disabled:hover:bg-gray-900 transition-colors"
            >
              {customSaving ? 'Adding...' : 'Add Provider'}
            </button>
          </div>
        )}
      </div>

      {configuredProviders.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">Configured</h3>
          <div className="space-y-1">
            {configuredProviders.map(([provider, status]) => {
              const popular = POPULAR_PROVIDERS.find(p => p.id === provider)
              return (
                <div
                  key={provider}
                  className="flex items-center gap-2.5 rounded-md border border-green-200 bg-green-50/40 px-3 py-2"
                >
                  <span
                    className="flex h-5 w-5 items-center justify-center rounded text-white text-[10px] font-bold flex-shrink-0"
                    style={{ backgroundColor: popular?.color ?? '#6b7280' }}
                  >
                    {popular?.name[0] ?? provider[0].toUpperCase()}
                  </span>
                  <div className="flex-1 min-w-0">
                    <span className="text-xs font-medium text-gray-900">{popular?.name ?? provider}</span>
                    {status.source && status.source !== 'stored' && (
                      <span className="ml-1.5 text-[10px] text-gray-400">({status.source})</span>
                    )}
                  </div>
                  <button
                    onClick={() => handleRemoveAuth(provider)}
                    disabled={removing === provider}
                    className="rounded p-1 text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors disabled:opacity-50"
                    title={`Remove ${popular?.name ?? provider} credentials`}
                  >
                    {removing === provider ? (
                      <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                    ) : (
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    )}
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

export default ProviderSetup
